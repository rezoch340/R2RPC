package io.rer0rpc.sdk

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

private const val MAXIMUM_METADATA_COUNT = 64
private const val MAXIMUM_STEP_COUNT = 128
private const val MAXIMUM_AUDIT_BYTES = 512 * 1024

data class AppAuditStepInput(
    val code: String? = null,
    val name: String,
    val request: AppAuditRequest? = null,
)

data class AppAuditStepSuccess(
    val status: JsonElement? = null,
    val response: AppAuditResponse? = null,
)

data class AppAuditStepFailure(
    val status: JsonElement? = null,
    val response: AppAuditResponse? = null,
    val error: AppAuditError,
)

class AppAuditRecorder(
    private val title: String,
    private val currentTimeMilliseconds: () -> Long = System::currentTimeMillis,
) {
    private val lock = Any()
    private val metadata = mutableListOf<AppAuditMetadata>()
    private val steps = mutableListOf<AppAuditStep>()
    private val completedStepIndexes = mutableSetOf<Int>()

    init {
        require(title.isNotBlank()) { "AppAudit title 不能为空" }
        require(title.length <= 200) { "AppAudit title 最多 200 个字符" }
    }

    fun addMetadata(
        key: String,
        value: JsonElement,
    ): AppAuditRecorder {
        require(key.isNotBlank()) { "AppAudit metadata key 不能为空" }
        require(key.length <= 100) {
            "AppAudit metadata key 最多 100 个字符"
        }
        synchronized(lock) {
            check(metadata.size < MAXIMUM_METADATA_COUNT) {
                "AppAudit metadata 最多 $MAXIMUM_METADATA_COUNT 项"
            }
            metadata += AppAuditMetadata(key, value)
        }
        return this
    }

    fun addMetadata(
        key: String,
        value: String,
    ): AppAuditRecorder = addMetadata(key, JsonPrimitive(value))

    fun startStep(input: AppAuditStepInput): AppAuditStepHandle {
        require(input.name.isNotBlank()) { "AppAudit Step name 不能为空" }
        require(input.name.length <= 200) {
            "AppAudit Step name 最多 200 个字符"
        }
        require(input.code == null || input.code.length <= 100) {
            "AppAudit Step code 最多 100 个字符"
        }
        validateRequest(input.request)
        val startedAtMilliseconds = currentTimeMilliseconds()
        val stepIndex =
            synchronized(lock) {
                check(steps.size < MAXIMUM_STEP_COUNT) {
                    "AppAudit Step 最多 $MAXIMUM_STEP_COUNT 项"
                }
                steps +=
                    AppAuditStep(
                        sequence = steps.size + 1,
                        code = input.code,
                        name = input.name,
                        startedAt = formatIsoTimestamp(startedAtMilliseconds),
                        durationMs = 0,
                        request = input.request,
                    )
                steps.lastIndex
            }
        return AppAuditStepHandle(
            recorder = this,
            stepIndex = stepIndex,
            startedAtMilliseconds = startedAtMilliseconds,
        )
    }

    fun snapshot(): AppAudit =
        synchronized(lock) {
            val snapshot =
                AppAudit(
                    title = title,
                    metadata = metadata.toList(),
                    steps = steps.toList(),
                )
            val encodedBytes =
                AUDIT_JSON_SERIALIZER
                    .encodeToString(AppAudit.serializer(), snapshot)
                    .toByteArray(Charsets.UTF_8)
                    .size
            check(encodedBytes <= MAXIMUM_AUDIT_BYTES) {
                "AppAudit 超过 512 KiB"
            }
            snapshot
        }

    internal fun completeStep(
        stepIndex: Int,
        startedAtMilliseconds: Long,
        status: JsonElement?,
        response: AppAuditResponse?,
        error: AppAuditError?,
    ) {
        synchronized(lock) {
            val existingStep = steps[stepIndex]
            check(stepIndex !in completedStepIndexes) {
                "AppAudit Step 已完成: ${existingStep.name}"
            }
            status?.let(::validateStatus)
            validateResponse(response)
            validateError(error)
            completedStepIndexes += stepIndex
            steps[stepIndex] =
                existingStep.copy(
                    durationMs =
                        (currentTimeMilliseconds() - startedAtMilliseconds).coerceAtLeast(0),
                    status = status,
                    response = response,
                    error = error,
                )
        }
    }

    private fun validateStatus(status: JsonElement) {
        require(
            status is JsonPrimitive &&
                (status.isString || status.doubleOrNull?.isFinite() == true),
        ) {
            "AppAudit Step status 只能是有限数字或字符串"
        }
        require(!status.isString || status.content.length <= 100) {
            "AppAudit Step status 字符串最多 100 个字符"
        }
    }

    private fun validateRequest(request: AppAuditRequest?) {
        require(request?.method == null || request.method.isNotBlank()) {
            "AppAudit request method 不能为空"
        }
        require(request?.method == null || request.method.length <= 32) {
            "AppAudit request method 最多 32 个字符"
        }
        require(request?.url == null || request.url.length <= 4096) {
            "AppAudit request url 最多 4096 个字符"
        }
    }

    private fun validateResponse(response: AppAuditResponse?) {
        require(
            response?.statusCode == null ||
                response.statusCode in 0..999,
        ) {
            "AppAudit response statusCode 必须在 0..999"
        }
    }

    private fun validateError(error: AppAuditError?) {
        require(error?.type == null || error.type.length <= 100) {
            "AppAudit error type 最多 100 个字符"
        }
        require(error?.code == null || error.code.length <= 100) {
            "AppAudit error code 最多 100 个字符"
        }
        require(error?.message == null || error.message.length <= 4096) {
            "AppAudit error message 最多 4096 个字符"
        }
    }
}

private val AUDIT_JSON_SERIALIZER =
    Json {
        encodeDefaults = true
        explicitNulls = false
    }

class AppAuditStepHandle internal constructor(
    private val recorder: AppAuditRecorder,
    private val stepIndex: Int,
    private val startedAtMilliseconds: Long,
) {
    fun succeed(result: AppAuditStepSuccess = AppAuditStepSuccess()) {
        recorder.completeStep(
            stepIndex = stepIndex,
            startedAtMilliseconds = startedAtMilliseconds,
            status = result.status,
            response = result.response,
            error = null,
        )
    }

    fun fail(result: AppAuditStepFailure) {
        recorder.completeStep(
            stepIndex = stepIndex,
            startedAtMilliseconds = startedAtMilliseconds,
            status = result.status,
            response = result.response,
            error = result.error,
        )
    }
}

private fun formatIsoTimestamp(timestampMilliseconds: Long): String =
    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
        .format(Date(timestampMilliseconds))
