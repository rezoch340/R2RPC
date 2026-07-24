package io.r2rpc.sdk

open class R2RpcException(
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)

class R2RpcHttpException(
    message: String,
    val statusCode: Int,
    val responseBody: String,
) : R2RpcException(message)

class R2RpcAuthenticationException(
    message: String = "设备令牌鉴权失败",
) : R2RpcException(message)

class R2RpcDeviceIdentifierException(
    message: String,
    cause: Throwable? = null,
) : R2RpcException(message, cause)
