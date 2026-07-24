# 设备 AppAudit V1 接入协议

RER0RPC 支持设备在最终 WebSocket `result` 中上报内部执行 Step。审计数据只进入请求日志，
不改变同步 invoke 响应。

官方 Android/Kotlin 与 JavaScript/TypeScript SDK 已内置 Recorder，优先按
[`sdk/README.md`](../sdk/README.md) 接入，不需要业务端手写 sequence、时间和耗时。

## 上报

```json
{
  "type": "result",
  "requestId": "uuid",
  "clientId": "device-001",
  "status": "ok",
  "is_ok": true,
  "httpCode": 200,
  "payload": { "ok": true },
  "appAudit": {
    "schemaVersion": 1,
    "title": "设备执行链路",
    "metadata": [
      { "key": "租户", "value": "tenant-001" }
    ],
    "steps": [
      {
        "sequence": 1,
        "code": "lookup",
        "name": "查询上游",
        "startedAt": "2026-07-24T12:00:00.000Z",
        "durationMs": 35,
        "status": 200,
        "request": {
          "method": "POST",
          "url": "https://example.test/lookup",
          "headers": { "content-type": "application/json" },
          "body": { "id": "fixture" }
        },
        "response": {
          "statusCode": 200,
          "headers": { "content-type": "application/json" },
          "bodyFormat": "json",
          "body": { "ok": true }
        }
      }
    ]
  }
}
```

失败 Step 可以同时保留上游响应：

```json
{
  "sequence": 2,
  "name": "调用备用上游",
  "startedAt": "2026-07-24T12:00:01.000Z",
  "durationMs": 1000,
  "status": 504,
  "response": {
    "statusCode": 504,
    "bodyFormat": "text",
    "body": "gateway timeout"
  },
  "error": {
    "type": "transport",
    "code": "TIMEOUT",
    "message": "upstream timeout"
  }
}
```

## 字段

```ts
type AppAudit = {
  schemaVersion: 1;
  title: string;
  metadata: Array<{ key: string; value: unknown }>;
  steps: Array<{
    sequence: number;
    code?: string;
    name: string;
    startedAt: string;
    durationMs: number;
    status?: number | string;
    request?: {
      method?: string;
      url?: string;
      headers?: unknown;
      body?: unknown;
    };
    response?: {
      statusCode?: number;
      headers?: unknown;
      bodyFormat?: 'json' | 'text' | 'empty';
      body?: unknown;
    };
    error?: {
      type?: string;
      code?: string;
      message?: string;
    };
  }>;
};
```

## 设备记录器要求

1. 每次 RPC 最多创建一份 AppAudit。
2. `sequence` 从 1 开始，按数组位置连续递增。
3. `startedAt` 使用带时区的 ISO 8601；`durationMs` 为非负数。
4. Step 开始时记录 request；完成时记录 response/status；失败时记录 error 和可选 response。
5. Step 只能完成一次。
6. 最终 `result` 一次性携带完整快照，不要逐 Step 单独发送。

## 限制与失败语义

- `appAudit` 最大 512 KiB。
- 最多 64 个 metadata、128 个 Step。
- WS 整帧仍受 4 MiB 上限约束。
- 非法审计会被整体丢弃，但 RPC 业务结果继续完成。
- `payload.appAudit` 是普通业务数据；只有 `result.appAudit` 是审计保留字段。
- 设备断线或 RPC 超时且没有最终 `result` 时，服务端无法获得尚未上报的内部 Step。

## 查询

管理员使用：

```text
GET /monitor/requests/:requestId
```

合法审计返回 `appAudit` 对象；未上报、非法或原始日志不可用时返回 `appAudit: null`。
列表 `GET /monitor/requests` 仍只返回 PostgreSQL 脊柱，不包含 payload 或审计。

完整设计和验收标准见
`docs/superpowers/specs/2026-07-24-device-app-audit-design.md`。
SDK 设计见
`docs/superpowers/specs/2026-07-24-device-sdks-design.md`。
