# 设备 AppAudit V1 接入协议

R2RPC 支持设备在最终 WebSocket `result` 中上报内部执行 Step。审计数据只进入请求日志，
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

### 精确字段约束

服务端按下表执行 V1 严格校验。表中“必填”表示属性必须存在；可选对象一旦提供，其内部字段仍
必须满足对应限制。

| 路径 | 必填 | 精确限制 |
|---|---:|---|
| `schemaVersion` | 是 | 只能为整数 `1` |
| `title` | 是 | 字符串，长度 1～200 |
| `metadata` | 是 | 数组，最多 64 项；允许空数组 |
| `metadata[].key` | 是 | 字符串，长度 1～100 |
| `metadata[].value` | 是 | 任意可 JSON 序列化的值 |
| `steps` | 是 | 数组，最多 128 项；允许空数组 |
| `steps[].sequence` | 是 | 整数 1～128，并且必须严格等于当前数组下标加 1 |
| `steps[].code` | 否 | 字符串，最大 100 |
| `steps[].name` | 是 | 字符串，长度 1～200 |
| `steps[].startedAt` | 是 | 带 `Z` 或明确时区偏移的 ISO 8601 日期时间 |
| `steps[].durationMs` | 是 | 有限数字，且不小于 0 |
| `steps[].status` | 否 | 有限数字，或最大 100 字符的字符串 |
| `request.method` | 否 | 字符串，长度 1～32 |
| `request.url` | 否 | 字符串，最大 4096 |
| `request.headers/body` | 否 | 任意可 JSON 序列化的值 |
| `response.statusCode` | 否 | 整数 0～999 |
| `response.headers/body` | 否 | 任意可 JSON 序列化的值 |
| `response.bodyFormat` | 否 | 只能为 `json`、`text` 或 `empty` |
| `error.type` | 否 | 字符串，最大 100 |
| `error.code` | 否 | 字符串，最大 100 |
| `error.message` | 否 | 字符串，最大 4096 |

`appAudit`、metadata、Step、request、response 和 error 对象全部使用 **strict object**
语义：任何未在 V1 中声明的额外字段都会导致整份 `appAudit` 被丢弃。需要携带扩展业务数据时，
应放入 `metadata[].value`、`request.body`、`response.body` 或 headers，而不是增加协议字段。

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
- 512 KiB 按 `JSON.stringify(appAudit)` 后的 UTF-8 字节数计算；循环引用、`BigInt` 等无法
  JSON 序列化的内容会判定为非法。
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
