# R2RPC SDK

本目录提供与当前 R2RPC 协议同步维护的官方设备端与调用方 SDK：

| SDK | 设备 WebSocket | 调用方 HTTP | 自动重连 | Action 超时 | AppAudit V1 |
|---|---:|---:|---:|---:|---:|
| [JavaScript / TypeScript](javascript/README.md) | ✅ | ✅ | ✅ | ✅ | ✅ |
| [Android / Kotlin](android/README.md) | ✅ | ✅ | ✅ | ✅ | ✅ |

两套 SDK 都只通过公开 HTTP/WebSocket 接口工作，不依赖后端内部模块，也不直接连接
PostgreSQL、Redis 或 Manticore。

## 身份边界

- 设备端使用 `dk_` Device Token，通过 `/api/client/ws` 注册上线。
- 调用方使用 `rk_` Access Token，通过 `/rpc/invoke/:project/:action` 发起调用。
- Android SDK 默认将 Widevine MediaDrm ID 编码为小写十六进制 `clientId`；JavaScript
  SDK 由宿主提供跨重启稳定的 `clientId`。
- 设备继承 Device Token 已绑定的功能组，不能通过 SDK 自报或扩大功能组范围。

## 协议行为

- 收到 `welcome` 后设备状态才进入在线。
- SDK 自动处理 heartbeat、异常断线指数退避和鉴权失败停止重连。
- Action 未注册、执行异常或超时都会转换成规范 `result`。
- AppAudit 由 Recorder 生成连续 Step，并随最终 `result.appAudit` 一次性上报。
- 调用方查询在线设备时仍受 Access Token 的功能组边界约束。

完整设计见
[Android 与 JavaScript SDK 设计](../docs/superpowers/specs/2026-07-24-device-sdks-design.md)，
审计字段见 [AppAudit V1 接入协议](../docs/device-app-audit.md)。
