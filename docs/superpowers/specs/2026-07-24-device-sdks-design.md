# Android 与 JavaScript SDK 设计

## 1. 目标

在当前仓库内提供 Android/Kotlin 与 JavaScript/TypeScript 两套官方 SDK，统一封装设备常驻
连接、调用方 HTTP 请求和 AppAudit V1 记录器，避免业务端重复手写协议帧、心跳、重连和
错误映射。

## 2. 边界

- SDK 只能调用公开 HTTP/WebSocket 接口，不导入后端源码，不访问持久层。
- 设备身份使用 `dk_` Device Token 和稳定 `clientId`；Android 默认使用 Widevine
  MediaDrm ID，JavaScript 由宿主持久化提供。
- 调用方身份使用 `rk_` Access Token；功能组和指定设备边界继续由服务端强制执行。
- SDK 不保存、签发或刷新令牌，不包含管理控制面 API。
- SDK 不实现手机业务 Action；只提供注册 Action 的运行框架。

## 3. 公共能力

### 3.1 设备端

1. 根据 `baseUrl` 构造 `/api/client/ws`，编码 token、clientId、platform、extra 和
   maxInFlight。
2. 收到 clientId 一致的 `welcome` 后进入 online。
3. 定时发送 heartbeat；服务端 ping 由底层 WebSocket 实现响应。
4. 异常断线按 500 ms 起步、30 s 封顶指数退避；鉴权关闭码 4001 停止重连。
5. 按 Action 名选择处理器，支持默认处理器和注销。
6. 将无处理器、异常、Action 超时映射为 `404/error`、`500/error`、`408/timeout`。
7. 结果必须携带服务端下发的 requestId 和本地 clientId，可选携带 AppAudit。

### 3.2 调用方

1. `invoke(project, action, payload, clientId?, timeoutSeconds?)`，payload 为 JSON object。
2. `listOnlineDevices(project)` 与 `isDeviceOnline(project, clientId)`。
3. 每个请求使用 Bearer Access Token。
4. 客户端超时或外部取消可中断请求；HTTP 错误保留状态与响应体。

### 3.3 AppAudit Recorder

1. 自动生成从 1 开始的连续 sequence、UTC ISO 时间和非负 durationMs。
2. 最多 64 个 metadata、128 个 Step。
3. Step 只能成功或失败完成一次，包括 0 ms 内完成的 Step。
4. snapshot 返回独立快照，供最终 `result.appAudit` 上报。
5. 字段形状与 `docs/device-app-audit.md` 的 V1 契约一致。

## 4. 平台实现

### JavaScript / TypeScript

- ESM 包 `@r2rpc/javascript-sdk`，输出 JavaScript 与声明文件。
- `isomorphic-ws` 统一 Node.js 与浏览器 WebSocket。
- 调用方使用标准 Fetch 和 AbortController。
- Vitest 覆盖 Recorder、HTTP 调用、WS Job/Result、未注册 Action 与超时。

### Android / Kotlin

- Maven 坐标 `io.r2rpc:r2rpc-android:0.1.0`。
- 产物为 `minSdk 21`、Java 8 字节码兼容的 Android AAR，不绑定 Activity 生命周期。
- 默认读取 `MediaDrm.PROPERTY_DEVICE_UNIQUE_ID`，编码为小写十六进制 `clientId` 并在进程内
  缓存；不使用每次启动变化的随机 ID。显式 `clientId` 仅用于旧设备映射迁移与测试。
- OkHttp 负责 HTTP/WebSocket，Coroutines 负责 Action 并发与超时，
  kotlinx.serialization 负责协议 JSON。
- MockWebServer 通过真实 HTTP/WebSocket 覆盖调用与设备帧。

## 5. 生命周期

- Device `start` 幂等；`stop` 停止连接并允许再次启动。
- JavaScript 设备在页面卸载或进程退出时调用 `stop`。
- Android `close` 是终态操作，并在 SDK 自建 OkHttpClient 时释放线程与连接池。
- Caller 不持有 JavaScript 后台资源；Android Caller 实现 Closeable 以释放自建客户端。

## 6. 验收

1. 两个 SDK 都能构建并生成发布制品。
2. 两个 SDK 都能接收 Job、执行 Action、返回规范 Result。
3. 自动路由与指定 clientId 调用均有公开 API 封装，Android 默认 clientId 来自 MediaDrm。
4. Action 超时只返回一次 timeout，不再发送迟到成功结果。
5. Recorder 生成可通过服务端 V1 校验的连续 Step，并拒绝重复完成。
6. 测试不导入后端模块或直接访问数据库、Redis、Manticore。
7. README 给出设备端、调用方和 AppAudit 的可复制示例。
