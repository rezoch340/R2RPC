package io.rer0rpc.sdk

import java.io.Closeable
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class Rer0RpcCallerOptions(
    val baseUrl: String,
    val accessToken: String,
    val requestTimeoutMilliseconds: Long = 20_000,
    val httpClient: OkHttpClient? = null,
)

@Serializable
private data class InvokeRequest(
    val payload: JsonObject,
    val timeoutSeconds: Int? = null,
)

class Rer0RpcCaller(
    private val options: Rer0RpcCallerOptions,
) : Closeable {
    init {
        require(options.baseUrl.isNotBlank()) { "baseUrl 不能为空" }
        require(options.accessToken.isNotBlank()) { "accessToken 不能为空" }
        require(options.requestTimeoutMilliseconds > 0) {
            "requestTimeoutMilliseconds 必须大于 0"
        }
    }

    private val ownsHttpClient = options.httpClient == null
    private val httpClient =
        options.httpClient
            ?: OkHttpClient
                .Builder()
                .callTimeout(options.requestTimeoutMilliseconds, TimeUnit.MILLISECONDS)
                .build()
    private val baseUrl = options.baseUrl.trimEnd('/')
    private val jsonSerializer =
        Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = false
        }

    suspend fun invoke(
        project: String,
        action: String,
        payload: JsonObject,
        clientId: String? = null,
        timeoutSeconds: Int? = null,
    ): RpcResponse {
        require(project.isNotBlank()) { "project 不能为空" }
        require(action.isNotBlank()) { "action 不能为空" }
        require(clientId == null || clientId.isNotBlank()) {
            "clientId 不能为空"
        }
        require(timeoutSeconds == null || timeoutSeconds > 0) {
            "timeoutSeconds 必须大于 0"
        }
        val querySuffix =
            clientId?.let { targetClientIdentifier ->
                "?clientId=${encodePathValue(targetClientIdentifier)}"
            }.orEmpty()
        val path =
            "/rpc/invoke/${encodePathValue(project)}/${encodePathValue(action)}$querySuffix"
        return request(
            method = "POST",
            path = path,
            requestBody =
                jsonSerializer.encodeToString(
                    InvokeRequest(payload, timeoutSeconds),
                ),
        )
    }

    suspend fun listOnlineDevices(project: String): ProjectOnlineDevices {
        require(project.isNotBlank()) { "project 不能为空" }
        return request(
            method = "GET",
            path = "/rpc/clientQueue?project=${encodePathValue(project)}",
        )
    }

    suspend fun isDeviceOnline(
        project: String,
        clientId: String,
    ): DeviceOnlineStatus {
        require(project.isNotBlank()) { "project 不能为空" }
        require(clientId.isNotBlank()) { "clientId 不能为空" }
        return request(
            method = "GET",
            path =
                "/rpc/clientQueue?project=${encodePathValue(project)}" +
                    "&clientId=${encodePathValue(clientId)}",
        )
    }

    private suspend inline fun <reified ResponseBody> request(
        method: String,
        path: String,
        requestBody: String? = null,
    ): ResponseBody =
        withContext(Dispatchers.IO) {
            val requestBuilder =
                Request
                    .Builder()
                    .url("$baseUrl$path")
                    .header("Authorization", "Bearer ${options.accessToken}")
            if (method == "POST") {
                requestBuilder.post(
                    checkNotNull(requestBody)
                        .toRequestBody(JSON_MEDIA_TYPE),
                )
            } else {
                requestBuilder.get()
            }
            httpClient.newCall(requestBuilder.build()).execute().use { response ->
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    throw Rer0RpcHttpException(
                        message = "$method $path 失败: HTTP ${response.code}",
                        statusCode = response.code,
                        responseBody = responseBody,
                    )
                }
                jsonSerializer.decodeFromString<ResponseBody>(responseBody)
            }
        }

    override fun close() {
        if (!ownsHttpClient) {
            return
        }
        httpClient.dispatcher.executorService.shutdown()
        httpClient.connectionPool.evictAll()
    }

    private fun encodePathValue(value: String): String =
        java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
