package io.rer0rpc.sdk

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

@Serializable
data class AppAuditMetadata(
    val key: String,
    val value: JsonElement,
)

@Serializable
data class AppAuditRequest(
    val method: String? = null,
    val url: String? = null,
    val headers: JsonElement? = null,
    val body: JsonElement? = null,
)

@Serializable
data class AppAuditResponse(
    val statusCode: Int? = null,
    val headers: JsonElement? = null,
    val bodyFormat: AppAuditBodyFormat? = null,
    val body: JsonElement? = null,
)

@Serializable
enum class AppAuditBodyFormat {
    @SerialName("json")
    JSON,

    @SerialName("text")
    TEXT,

    @SerialName("empty")
    EMPTY,
}

@Serializable
data class AppAuditError(
    val type: String? = null,
    val code: String? = null,
    val message: String? = null,
)

@Serializable
data class AppAuditStep(
    val sequence: Int,
    val code: String? = null,
    val name: String,
    val startedAt: String,
    val durationMs: Long,
    val status: JsonElement? = null,
    val request: AppAuditRequest? = null,
    val response: AppAuditResponse? = null,
    val error: AppAuditError? = null,
)

@Serializable
data class AppAudit(
    val schemaVersion: Int = 1,
    val title: String,
    val metadata: List<AppAuditMetadata>,
    val steps: List<AppAuditStep>,
)

@Serializable
data class RpcJob(
    val type: String,
    val requestId: String,
    val project: String,
    val action: String,
    val payload: JsonElement = JsonNull,
    val timeoutSeconds: Int,
    val deadlineAt: Long? = null,
)

data class DeviceActionResult(
    val payload: JsonElement? = null,
    val status: String? = null,
    val isOk: Boolean = true,
    val httpCode: Int? = null,
    val error: String? = null,
    val appAudit: AppAudit? = null,
)

fun interface DeviceActionHandler {
    suspend fun handle(job: RpcJob): DeviceActionResult
}

@Serializable
data class RpcResponse(
    val requestId: String,
    val clientId: String? = null,
    @SerialName("is_ok")
    val isOk: Boolean,
    val status: String,
    val httpCode: Int,
    val latencyMs: Long,
    val payload: JsonElement? = null,
    val error: String? = null,
)

@Serializable
data class ProjectOnlineDevices(
    val project: String,
    val online: List<String>,
)

@Serializable
data class DeviceOnlineStatus(
    val clientId: String,
    val online: Boolean,
)

enum class DeviceConnectionState {
    IDLE,
    CONNECTING,
    ONLINE,
    RECONNECTING,
    STOPPED,
}

data class DeviceConnectionEvent(
    val state: DeviceConnectionState,
    val reconnectAttempt: Int,
)
