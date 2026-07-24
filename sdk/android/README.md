# RER0RPC Android / Kotlin SDK

Android SDK 是 `minSdk 21`、Java 8 字节码兼容的 Android Library（AAR），使用 OkHttp
WebSocket、Kotlin Coroutines 和 kotlinx.serialization。它不依赖 Activity 或 Service，可用于
普通 Android App、前台服务以及 Xposed 宿主模块。

设备端默认读取 Widevine `MediaDrm.PROPERTY_DEVICE_UNIQUE_ID`，编码为小写十六进制并作为
RER0RPC `clientId`。读取结果在进程内只初始化一次，不需要电话、存储或广告权限；相同 APK
作用域内可跨进程重启保持稳定。

## 引入

当前仓库可先发布到 Maven Local：

```bash
cd sdk/android
./gradlew :rer0rpc-sdk:publishToMavenLocal
```

在 Android 项目的仓库和依赖中加入：

```kotlin
repositories {
    mavenLocal()
    mavenCentral()
}

dependencies {
    implementation("io.rer0rpc:rer0rpc-android:0.1.0")
}
```

SDK 的 AAR 已声明 `android.permission.INTERNET`，应用 Manifest 合并后会自动包含该权限。

## 设备上线

`Rer0RpcDeviceOptions.clientId` 默认使用 MediaDrm ID，不需要业务自行生成或持久化。
`baseUrl` 传 RER0RPC HTTP(S) 服务根地址，不要附加 `/api/client/ws`。

```kotlin
import io.rer0rpc.sdk.AppAuditRecorder
import io.rer0rpc.sdk.AppAuditBodyFormat
import io.rer0rpc.sdk.AppAuditResponse
import io.rer0rpc.sdk.AppAuditStepInput
import io.rer0rpc.sdk.AppAuditStepSuccess
import io.rer0rpc.sdk.DeviceActionResult
import io.rer0rpc.sdk.Rer0RpcDevice
import io.rer0rpc.sdk.Rer0RpcDeviceOptions
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

val device =
    Rer0RpcDevice(
        Rer0RpcDeviceOptions(
            baseUrl = "https://relay.example.com",
            deviceToken = BuildConfig.RER0RPC_DEVICE_TOKEN,
            platform = "android",
            extra =
                buildJsonObject {
                    put("applicationVersion", BuildConfig.VERSION_NAME)
                },
            maxInFlight = 512,
            onConnectionEvent = { event ->
                Log.i("RER0RPC", "${event.state}: ${event.reconnectAttempt}")
            },
            onError = { throwable ->
                Log.e("RER0RPC", "connection error", throwable)
            },
        ),
    )

device.registerAction("hello") { job ->
    val audit = AppAuditRecorder("Android Hello")
    val step =
        audit.startStep(
            AppAuditStepInput(
                name = "构造响应",
            ),
        )
    val payload =
        buildJsonObject {
            put("message", "hello from Android")
            put("received", job.payload)
        }
    step.succeed(
        AppAuditStepSuccess(
            status = kotlinx.serialization.json.JsonPrimitive(200),
            response =
                AppAuditResponse(
                    statusCode = 200,
                    bodyFormat = AppAuditBodyFormat.JSON,
                    body = payload,
                ),
        ),
    )
    DeviceActionResult(
        payload = payload,
        appAudit = audit.snapshot(),
    )
}

device.start()
```

- `start()` 可重复调用，不会建立重复连接。
- `stop()` 停止并允许后续再次 `start()`。
- `close()` 用于宿主永久销毁，释放 SDK 自建的线程和连接；调用后不要重新启动。
- `device.clientId` 暴露当前连接使用的 MediaDrm ID；迁移旧设备映射或 JVM 测试时可显式
  传入 `Rer0RpcDeviceOptions.clientId` 覆盖默认值。
- Action 处理器运行在 SDK 的 IO CoroutineScope，不阻塞主线程。
- 未注册、抛错和超时分别自动转换为规范的 `404/error`、`500/error` 和
  `408/timeout` result。

## 调用 RPC

```kotlin
import io.rer0rpc.sdk.Rer0RpcCaller
import io.rer0rpc.sdk.Rer0RpcCallerOptions
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

val caller =
    Rer0RpcCaller(
        Rer0RpcCallerOptions(
            baseUrl = "https://relay.example.com",
            accessToken = accessToken,
        ),
    )

val response =
    caller.invoke(
        project = "cn-nodes",
        action = "hello",
        payload =
            buildJsonObject {
                put("message", "hello from Android caller")
            },
        clientId = null,
        timeoutSeconds = 10,
    )

val onlineDevices = caller.listOnlineDevices("cn-nodes")
val deviceStatus = caller.isDeviceOnline("cn-nodes", device.clientId)
caller.close()
```

调用方方法均为 `suspend`，可在 ViewModel、Service 或其他 CoroutineScope 中调用。HTTP
非 2xx 响应会抛出 `Rer0RpcHttpException`，其中保留状态码和原始响应体。
`payload` 使用 `JsonObject`；数组、字符串和其他顶层标量不符合当前 invoke DTO。

## 开发验证

```bash
cd sdk/android
./gradlew :rer0rpc-sdk:testDebugUnitTest :rer0rpc-sdk:assembleRelease
```

测试使用 MockWebServer 走真实 HTTP 和 WebSocket 协议，不调用后端内部模块。
