package io.rer0rpc.sdk

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class Rer0RpcCallerTest {
    private val server = MockWebServer()

    @AfterTest
    fun stopServer() {
        server.shutdown()
    }

    @Test
    fun `通过 Access Token 调用指定设备`() =
        runBlocking {
            server.enqueue(
                MockResponse()
                    .setResponseCode(201)
                    .setBody(
                        """
                        {
                          "requestId":"request-1",
                          "clientId":"device-1",
                          "is_ok":true,
                          "status":"ok",
                          "httpCode":200,
                          "latencyMs":5,
                          "payload":{"message":"hello"}
                        }
                        """.trimIndent(),
                    ),
            )
            val caller =
                Rer0RpcCaller(
                    Rer0RpcCallerOptions(
                        baseUrl = server.url("/").toString(),
                        accessToken = "rk_fixture",
                    ),
                )

            val response =
                caller.invoke(
                    project = "cn-nodes",
                    action = "hello",
                    payload = JsonObject(mapOf("message" to JsonPrimitive("hello"))),
                    clientId = "device-1",
                    timeoutSeconds = 5,
                )

            assertEquals("device-1", response.clientId)
            val request = server.takeRequest()
            assertEquals(
                "/rpc/invoke/cn-nodes/hello?clientId=device-1",
                request.path,
            )
            assertEquals("Bearer rk_fixture", request.getHeader("Authorization"))
            val requestBody =
                Json.parseToJsonElement(request.body.readUtf8()) as JsonObject
            assertEquals(JsonPrimitive(5), requestBody["timeoutSeconds"])
            caller.close()
        }

    @Test
    fun `HTTP 错误保留状态和响应体`() =
        runBlocking {
            server.enqueue(
                MockResponse()
                    .setResponseCode(401)
                    .setBody("""{"message":"unauthorized"}"""),
            )
            val caller =
                Rer0RpcCaller(
                    Rer0RpcCallerOptions(
                        baseUrl = server.url("/").toString(),
                        accessToken = "rk_fixture",
                    ),
                )

            val exception =
                assertFailsWith<Rer0RpcHttpException> {
                    caller.listOnlineDevices("cn-nodes")
                }

            assertEquals(401, exception.statusCode)
            assertTrue(exception.responseBody.contains("unauthorized"))
            caller.close()
        }

    @Test
    fun `在发请求前拒绝非法调用参数`() {
        val caller =
            Rer0RpcCaller(
                Rer0RpcCallerOptions(
                    baseUrl = server.url("/").toString(),
                    accessToken = "rk_fixture",
                ),
            )

        assertFailsWith<IllegalArgumentException> {
            runBlocking {
                caller.invoke(
                    project = "cn-nodes",
                    action = "hello",
                    payload = JsonObject(emptyMap()),
                    timeoutSeconds = 0,
                )
            }
        }
        caller.close()
    }
}
