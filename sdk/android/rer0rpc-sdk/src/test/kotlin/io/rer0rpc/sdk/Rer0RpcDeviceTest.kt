package io.rer0rpc.sdk

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class Rer0RpcDeviceTest {
    private val server = MockWebServer()

    @AfterTest
    fun stopServer() {
        server.shutdown()
    }

    @Test
    fun `通过真实 WebSocket 处理 Job 并返回 Result`() {
        assertEquals(
            "000fa5ff",
            AndroidDeviceIdentifier.encodeAsLowercaseHexadecimal(
                byteArrayOf(0x00, 0x0f, 0xa5.toByte(), 0xff.toByte()),
            ),
        )
        val resultLatch = CountDownLatch(1)
        var receivedResult: JsonObject? = null
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(
                        webSocket: WebSocket,
                        response: Response,
                    ) {
                        webSocket.send(
                            """
                            {
                              "type":"welcome",
                              "clientId":"device-1",
                              "projects":[1],
                              "maxInFlight":512
                            }
                            """.trimIndent(),
                        )
                        webSocket.send(
                            """
                            {
                              "type":"job",
                              "requestId":"request-1",
                              "project":"cn-nodes",
                              "action":"hello",
                              "payload":{"message":"hello"},
                              "timeoutSeconds":5
                            }
                            """.trimIndent(),
                        )
                    }

                    override fun onMessage(
                        webSocket: WebSocket,
                        text: String,
                    ) {
                        val message = Json.parseToJsonElement(text) as JsonObject
                        if (message["type"] == JsonPrimitive("result")) {
                            receivedResult = message
                            resultLatch.countDown()
                        }
                    }

                    override fun onClosing(
                        webSocket: WebSocket,
                        code: Int,
                        reason: String,
                    ) {
                        webSocket.close(code, reason)
                    }
                },
            ),
        )
        val device =
            Rer0RpcDevice(
                Rer0RpcDeviceOptions(
                    baseUrl = server.url("/").toString(),
                    deviceToken = "dk_fixture",
                    clientId = "device-1",
                    platform = "android",
                    heartbeatIntervalMilliseconds = 60_000,
                ),
            )
        device.registerAction("hello") { job ->
            val audit = AppAuditRecorder("Android test")
            audit.startStep(AppAuditStepInput(name = "响应")).succeed()
            DeviceActionResult(
                payload =
                    JsonObject(
                        mapOf(
                            "received" to job.payload,
                            "platform" to JsonPrimitive("android"),
                        ),
                    ),
                appAudit = audit.snapshot(),
            )
        }

        device.start()

        assertTrue(resultLatch.await(5, TimeUnit.SECONDS))
        assertEquals(JsonPrimitive("request-1"), receivedResult?.get("requestId"))
        assertEquals(JsonPrimitive("device-1"), receivedResult?.get("clientId"))
        assertEquals(JsonPrimitive(true), receivedResult?.get("is_ok"))
        assertEquals(JsonPrimitive("ok"), receivedResult?.get("status"))
        val appAudit = receivedResult?.get("appAudit") as JsonObject
        assertEquals(JsonPrimitive(1), appAudit["schemaVersion"])
        val request = server.takeRequest()
        assertEquals("/api/client/ws", request.requestUrl?.encodedPath)
        assertEquals("dk_fixture", request.requestUrl?.queryParameter("token"))
        assertEquals("device-1", request.requestUrl?.queryParameter("clientId"))
        assertEquals("android", request.requestUrl?.queryParameter("platform"))
        device.close()
    }

    @Test
    fun `Action 超时后返回 timeout`() {
        val resultLatch = CountDownLatch(1)
        var receivedResult: JsonObject? = null
        server.enqueue(
            MockResponse().withWebSocketUpgrade(
                object : WebSocketListener() {
                    override fun onOpen(
                        webSocket: WebSocket,
                        response: Response,
                    ) {
                        webSocket.send(
                            """{"type":"welcome","clientId":"device-1","projects":[1],"maxInFlight":512}""",
                        )
                        webSocket.send(
                            """
                            {
                              "type":"job",
                              "requestId":"request-timeout",
                              "project":"cn-nodes",
                              "action":"slow",
                              "payload":{},
                              "timeoutSeconds":1
                            }
                            """.trimIndent(),
                        )
                    }

                    override fun onMessage(
                        webSocket: WebSocket,
                        text: String,
                    ) {
                        val message = Json.parseToJsonElement(text) as JsonObject
                        if (message["type"] == JsonPrimitive("result")) {
                            receivedResult = message
                            resultLatch.countDown()
                        }
                    }

                    override fun onClosing(
                        webSocket: WebSocket,
                        code: Int,
                        reason: String,
                    ) {
                        webSocket.close(code, reason)
                    }
                },
            ),
        )
        val device =
            Rer0RpcDevice(
                Rer0RpcDeviceOptions(
                    baseUrl = server.url("/").toString(),
                    deviceToken = "dk_fixture",
                    clientId = "device-1",
                ),
            )
        device.registerAction("slow") {
            Thread.sleep(2_000)
            DeviceActionResult()
        }

        device.start()

        assertTrue(resultLatch.await(3, TimeUnit.SECONDS))
        assertEquals(JsonPrimitive("timeout"), receivedResult?.get("status"))
        assertEquals(JsonPrimitive(false), receivedResult?.get("is_ok"))
        assertEquals(JsonPrimitive(408), receivedResult?.get("httpCode"))
        device.close()
    }
}
