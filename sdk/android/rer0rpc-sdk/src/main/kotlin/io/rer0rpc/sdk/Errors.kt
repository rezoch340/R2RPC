package io.rer0rpc.sdk

open class Rer0RpcException(
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

class Rer0RpcHttpException(
    message: String,
    val statusCode: Int,
    val responseBody: String,
) : Rer0RpcException(message)

class Rer0RpcAuthenticationException(
    message: String = "设备令牌鉴权失败",
) : Rer0RpcException(message)

class Rer0RpcDeviceIdentifierException(
    message: String,
    cause: Throwable? = null,
) : Rer0RpcException(message, cause)
