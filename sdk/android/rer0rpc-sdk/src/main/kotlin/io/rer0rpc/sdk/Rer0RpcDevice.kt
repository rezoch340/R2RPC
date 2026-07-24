package io.rer0rpc.sdk

import java.io.Closeable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

data class Rer0RpcDeviceOptions(
    val baseUrl: String,
    val deviceToken: String,
    val clientId: String = AndroidDeviceIdentifier.fromWidevineMediaDrm(),
    val platform: String? = null,
    val extra: JsonElement? = null,
    val maxInFlight: Int? = null,
    val heartbeatIntervalMilliseconds: Long = 10_000,
    val reconnectInitialDelayMilliseconds: Long = 500,
    val reconnectMaximumDelayMilliseconds: Long = 30_000,
    val httpClient: OkHttpClient? = null,
    val onConnectionEvent: (DeviceConnectionEvent) -> Unit = {},
    val onError: (Throwable) -> Unit = {},
)

class Rer0RpcDevice(
    private val options: Rer0RpcDeviceOptions,
) : Closeable {
    init {
        require(options.baseUrl.isNotBlank()) { "baseUrl 不能为空" }
        require(options.deviceToken.isNotBlank()) { "deviceToken 不能为空" }
        require(options.clientId.isNotBlank()) { "clientId 不能为空" }
        require(options.heartbeatIntervalMilliseconds > 0) {
            "heartbeatIntervalMilliseconds 必须大于 0"
        }
        require(options.reconnectInitialDelayMilliseconds > 0) {
            "reconnectInitialDelayMilliseconds 必须大于 0"
        }
        require(options.reconnectMaximumDelayMilliseconds > 0) {
            "reconnectMaximumDelayMilliseconds 必须大于 0"
        }
    }

    private val actionHandlers = ConcurrentHashMap<String, DeviceActionHandler>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val running = AtomicBoolean(false)
    private val ownsHttpClient = options.httpClient == null
    private val httpClient =
        options.httpClient
            ?: OkHttpClient
                .Builder()
                .pingInterval(10, TimeUnit.SECONDS)
                .build()
    private val jsonSerializer =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = true
        }
    private val mutableState = MutableStateFlow(DeviceConnectionState.IDLE)
    private var webSocket: WebSocket? = null
    private var heartbeatJob: Job? = null
    private var reconnectJob: Job? = null
    private var reconnectAttempt = 0
    @Volatile
    private var defaultHandler: DeviceActionHandler? = null

    val clientId: String = options.clientId
    val state: StateFlow<DeviceConnectionState> = mutableState.asStateFlow()

    fun registerAction(
        action: String,
        handler: DeviceActionHandler,
    ): Closeable {
        require(action.isNotBlank()) { "action 不能为空" }
        actionHandlers[action] = handler
        return Closeable { actionHandlers.remove(action, handler) }
    }

    fun registerDefaultHandler(handler: DeviceActionHandler): Closeable {
        defaultHandler = handler
        return Closeable {
            if (defaultHandler === handler) {
                defaultHandler = null
            }
        }
    }

    fun start() {
        if (!running.compareAndSet(false, true)) {
            return
        }
        reconnectAttempt = 0
        openConnection(DeviceConnectionState.CONNECTING)
    }

    fun stop() {
        if (!running.compareAndSet(true, false)) {
            return
        }
        heartbeatJob?.cancel()
        reconnectJob?.cancel()
        webSocket?.close(1000, "client stopped")
        webSocket = null
        updateState(DeviceConnectionState.STOPPED)
    }

    override fun close() {
        stop()
        scope.cancel()
        if (ownsHttpClient) {
            httpClient.dispatcher.cancelAll()
            httpClient.dispatcher.executorService.shutdown()
            httpClient.connectionPool.evictAll()
        }
    }

    private fun openConnection(connectionState: DeviceConnectionState) {
        updateState(connectionState)
        webSocket =
            httpClient.newWebSocket(
                Request.Builder().url(buildWebSocketUrl()).build(),
                DeviceWebSocketListener(),
            )
    }

    private fun buildWebSocketUrl(): String {
        val httpUrl = options.baseUrl.toHttpUrl()
        return httpUrl
            .newBuilder()
            .encodedPath("/api/client/ws")
            .query(null)
            .addQueryParameter("token", options.deviceToken)
            .addQueryParameter("clientId", options.clientId)
            .apply {
                options.platform?.let { platform ->
                    addQueryParameter("platform", platform)
                }
                options.extra?.let { extra ->
                    addQueryParameter("extra", extra.toString())
                }
                options.maxInFlight?.let { maximumInFlight ->
                    addQueryParameter("maxInFlight", maximumInFlight.toString())
                }
            }.build()
            .toString()
    }

    private fun handleMessage(
        socket: WebSocket,
        serializedMessage: String,
    ) {
        if (webSocket !== socket) {
            return
        }
        val message =
            runCatching {
                jsonSerializer.parseToJsonElement(serializedMessage) as? JsonObject
            }
                .getOrNull()
                ?: return
        when (message["type"]?.jsonPrimitive?.contentOrNull) {
            "welcome" -> handleWelcome(message)
            "job" -> handleJob(socket, message)
        }
    }

    private fun handleWelcome(message: JsonObject) {
        if (message["clientId"]?.jsonPrimitive?.contentOrNull != options.clientId) {
            options.onError(Rer0RpcException("welcome clientId 与本地设备不一致"))
            webSocket?.close(4003, "clientId mismatch")
            return
        }
        reconnectAttempt = 0
        updateState(DeviceConnectionState.ONLINE)
        startHeartbeat()
    }

    private fun handleJob(
        socket: WebSocket,
        message: JsonObject,
    ) {
        val job =
            runCatching {
                jsonSerializer.decodeFromJsonElement(RpcJob.serializer(), message)
            }
                .getOrElse { parsingFailure ->
                    options.onError(
                        Rer0RpcException("无法解析 RPC Job", parsingFailure),
                    )
                    return
                }
        scope.launch {
            val result = executeJob(job)
            socket.send(buildResult(job, result).toString())
        }
    }

    private suspend fun executeJob(job: RpcJob): DeviceActionResult {
        if (job.deadlineAt != null && job.deadlineAt <= System.currentTimeMillis()) {
            return DeviceActionResult(
                status = "timeout",
                isOk = false,
                httpCode = 408,
                error = "job deadline 已过期",
            )
        }
        val handler = actionHandlers[job.action] ?: defaultHandler
        if (handler == null) {
            return DeviceActionResult(
                status = "error",
                isOk = false,
                httpCode = 404,
                error = "未注册 Action: ${job.action}",
            )
        }
        val timeoutMilliseconds = resolveTimeoutMilliseconds(job)
        val handlerExecution =
            scope.async {
                handler.handle(job)
            }
        return try {
            withTimeout(timeoutMilliseconds) {
                handlerExecution.await()
            }
        } catch (_: TimeoutCancellationException) {
            handlerExecution.cancel()
            DeviceActionResult(
                status = "timeout",
                isOk = false,
                httpCode = 408,
                error = "Action 执行超过 $timeoutMilliseconds ms",
            )
        } catch (cancellation: CancellationException) {
            handlerExecution.cancel()
            throw cancellation
        } catch (throwable: Throwable) {
            handlerExecution.cancel()
            DeviceActionResult(
                status = "error",
                isOk = false,
                httpCode = 500,
                error = throwable.message ?: throwable::class.java.simpleName,
            )
        }
    }

    private fun resolveTimeoutMilliseconds(job: RpcJob): Long {
        val configuredTimeoutMilliseconds =
            (job.timeoutSeconds.coerceAtLeast(1) * 1_000L)
        val deadlineAt = job.deadlineAt ?: return configuredTimeoutMilliseconds
        return minOf(
            configuredTimeoutMilliseconds,
            (deadlineAt - System.currentTimeMillis()).coerceAtLeast(1),
        )
    }

    private fun buildResult(
        job: RpcJob,
        result: DeviceActionResult,
    ): JsonObject =
        buildJsonObject {
            put("type", JsonPrimitive("result"))
            put("requestId", JsonPrimitive(job.requestId))
            put("clientId", JsonPrimitive(options.clientId))
            put(
                "status",
                JsonPrimitive(result.status ?: if (result.isOk) "ok" else "error"),
            )
            put("is_ok", JsonPrimitive(result.isOk))
            put(
                "httpCode",
                JsonPrimitive(result.httpCode ?: if (result.isOk) 200 else 500),
            )
            result.payload?.let { payload ->
                put("payload", payload)
            }
            result.error?.let { errorMessage ->
                put("error", JsonPrimitive(errorMessage))
            }
            result.appAudit?.let { appAudit ->
                put(
                    "appAudit",
                    jsonSerializer.encodeToJsonElement(
                        AppAudit.serializer(),
                        appAudit,
                    ),
                )
            }
        }

    private fun startHeartbeat() {
        heartbeatJob?.cancel()
        heartbeatJob =
            scope.launch {
                while (isActive && running.get()) {
                    delay(options.heartbeatIntervalMilliseconds)
                    webSocket?.send("""{"type":"heartbeat"}""")
                }
            }
    }

    private fun scheduleReconnect() {
        if (!running.get() || reconnectJob?.isActive == true) {
            return
        }
        reconnectAttempt += 1
        updateState(DeviceConnectionState.RECONNECTING)
        val reconnectDelay =
            (
                options.reconnectInitialDelayMilliseconds *
                    (1L shl (reconnectAttempt - 1).coerceAtMost(20))
            ).coerceAtMost(options.reconnectMaximumDelayMilliseconds)
        reconnectJob =
            scope.launch {
                delay(reconnectDelay)
                if (running.get()) {
                    openConnection(DeviceConnectionState.RECONNECTING)
                }
            }
    }

    private fun updateState(connectionState: DeviceConnectionState) {
        mutableState.value = connectionState
        options.onConnectionEvent(
            DeviceConnectionEvent(connectionState, reconnectAttempt),
        )
    }

    private inner class DeviceWebSocketListener : WebSocketListener() {
        override fun onOpen(
            webSocket: WebSocket,
            response: Response,
        ) {
            if (this@Rer0RpcDevice.webSocket !== webSocket) {
                webSocket.cancel()
            }
        }

        override fun onMessage(
            webSocket: WebSocket,
            text: String,
        ) {
            handleMessage(webSocket, text)
        }

        override fun onClosed(
            webSocket: WebSocket,
            code: Int,
            reason: String,
        ) {
            handleDisconnection(webSocket, code, null)
        }

        @Suppress("PARAMETER_NAME_CHANGED_ON_OVERRIDE")
        override fun onFailure(
            webSocket: WebSocket,
            throwable: Throwable,
            response: Response?,
        ) {
            handleDisconnection(webSocket, response?.code, throwable)
        }
    }

    private fun handleDisconnection(
        disconnectedWebSocket: WebSocket,
        closeCode: Int?,
        failure: Throwable?,
    ) {
        if (webSocket !== disconnectedWebSocket) {
            return
        }
        webSocket = null
        heartbeatJob?.cancel()
        failure?.let(options.onError)
        if (!running.get()) {
            updateState(DeviceConnectionState.STOPPED)
            return
        }
        if (closeCode == 4001) {
            running.set(false)
            updateState(DeviceConnectionState.STOPPED)
            options.onError(Rer0RpcAuthenticationException())
            return
        }
        scheduleReconnect()
    }
}
