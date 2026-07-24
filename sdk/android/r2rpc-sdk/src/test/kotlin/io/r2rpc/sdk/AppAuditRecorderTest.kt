package io.r2rpc.sdk

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.serialization.json.JsonPrimitive

class AppAuditRecorderTest {
    @Test
    fun `生成连续 Step 并防止重复完成`() {
        var currentTimeMilliseconds =
            Instant.parse("2026-07-24T12:00:00.000Z").toEpochMilli()
        val recorder =
            AppAuditRecorder(
                title = "设备执行链路",
                currentTimeMilliseconds = { currentTimeMilliseconds },
            ).addMetadata("device", "device-001")
        val step =
            recorder.startStep(
                AppAuditStepInput(
                    code = "hello",
                    name = "处理 Hello",
                    request =
                        AppAuditRequest(
                            method = "LOCAL",
                            body = JsonPrimitive("hello"),
                        ),
                ),
            )

        currentTimeMilliseconds += 35
        step.succeed(
            AppAuditStepSuccess(
                status = JsonPrimitive(200),
                response =
                    AppAuditResponse(
                        statusCode = 200,
                        bodyFormat = AppAuditBodyFormat.JSON,
                        body = JsonPrimitive("hello"),
                    ),
            ),
        )

        val snapshot = recorder.snapshot()
        assertEquals(1, snapshot.schemaVersion)
        assertEquals("设备执行链路", snapshot.title)
        assertEquals(1, snapshot.steps.size)
        assertEquals(1, snapshot.steps.single().sequence)
        assertEquals(35, snapshot.steps.single().durationMs)
        assertEquals(JsonPrimitive(200), snapshot.steps.single().status)
        assertFailsWith<IllegalStateException> {
            step.succeed()
        }
    }

    @Test
    fun `零毫秒完成仍不能再次完成`() {
        val recorder =
            AppAuditRecorder(
                title = "零耗时步骤",
                currentTimeMilliseconds = { 1_000L },
            )
        val step = recorder.startStep(AppAuditStepInput(name = "读取缓存"))

        step.succeed()

        assertEquals(0, recorder.snapshot().steps.single().durationMs)
        assertFailsWith<IllegalStateException> {
            step.fail(
                AppAuditStepFailure(
                    error = AppAuditError(message = "duplicate"),
                ),
            )
        }
    }

    @Test
    fun `拒绝超过 512 KiB 的快照`() {
        val recorder =
            AppAuditRecorder("large audit")
                .addMetadata("payload", "x".repeat(513 * 1024))

        assertFailsWith<IllegalStateException> {
            recorder.snapshot()
        }
    }
}
