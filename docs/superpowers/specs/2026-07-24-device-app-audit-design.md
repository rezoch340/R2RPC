# 设备上报 AppAudit 日志 Step 设计

> 状态：✅ 已实施。
>
> 日期：2026-07-24。
>
> 参考实现：`/Users/lpitiless/Documents/FlowCore/backend/src/common/app-audit/` 与
> `/Users/lpitiless/Documents/FlowCore/frontend/components/request-log-detail.tsx`。

## 1. 背景

RER0RPC 已能记录整次 RPC 的请求、响应、状态、耗时和错误，但设备内部执行过程对服务端不可见。
FlowCore 的 `fields.appAudit` 使用通用 `metadata + steps` 描述多段上游调用，适合复用为请求日志详情。

RER0RPC 与 FlowCore 的执行位置不同：

- FlowCore 在后端 App 内执行上游调用，Core 可以直接记录 Step。
- RER0RPC 在远端设备执行动作，服务端只能看到最终 WS `result`。

因此，业务 Step 必须由设备采集，并随最终 `result` 一次性上报。

## 2. 目标

1. WS `result` 支持可选的 `appAudit` V1。
2. 服务端对不可信设备输入执行结构、顺序、数量和体积校验。
3. 合法审计数据进入请求日志冷路径，不增加 PostgreSQL 脊柱体积。
4. `GET /monitor/requests/:requestId` 返回结构化 `appAudit`。
5. 现有设备不传 `appAudit` 时完全兼容。
6. 黑盒验收只使用 HTTP 和真实 WebSocket，不直接访问 PostgreSQL、Redis 或 Manticore。

## 3. 非目标

- 第一版不支持逐 Step 的流式 `audit_step` 消息。
- 不在服务端伪造设备内部 Step。
- 不在本仓库实现具体设备 SDK；本文给出设备侧协议和记录器行为要求。
- 不把 `appAudit` 返回给同步 RPC 调用方；它只进入日志详情。
- 不把原始 Step 内容写入 PostgreSQL。

## 4. WS 协议

设备可以在最终 `result` 顶层增加 `appAudit`：

```json
{
  "type": "result",
  "requestId": "8b9b8b9d-85cc-44c4-9a62-2dc8af423ac0",
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

`payload.appAudit` 只是普通业务数据，不作为审计字段。只有 `result.appAudit` 是 Core 协议保留字段。

## 5. AppAudit V1 契约

```ts
type AppAuditMetadata = {
  key: string;
  value: unknown;
};

type AppAuditRequest = {
  method?: string;
  url?: string;
  headers?: unknown;
  body?: unknown;
};

type AppAuditResponse = {
  statusCode?: number;
  headers?: unknown;
  bodyFormat?: 'json' | 'text' | 'empty';
  body?: unknown;
};

type AppAuditError = {
  type?: string;
  code?: string;
  message?: string;
};

type AppAuditStep = {
  sequence: number;
  code?: string;
  name: string;
  startedAt: string;
  durationMs: number;
  status?: number | string;
  request?: AppAuditRequest;
  response?: AppAuditResponse;
  error?: AppAuditError;
};

type AppAudit = {
  schemaVersion: 1;
  title: string;
  metadata: AppAuditMetadata[];
  steps: AppAuditStep[];
};
```

### 5.1 服务端校验边界

| 项目 | 限制 |
|---|---:|
| 编码后 `appAudit` 总体积 | 512 KiB |
| `metadata` | 最多 64 项 |
| `steps` | 最多 128 项 |
| `title` / Step `name` | 1–200 字符 |
| metadata `key` / Step `code` | 最多 100 字符 |
| request `method` | 最多 32 字符 |
| request `url` | 最多 4096 字符 |
| error `type` / `code` | 最多 100 字符 |
| error `message` | 最多 4096 字符 |
| `startedAt` | 带时区的 ISO 8601 |
| `durationMs` | 非负有限数 |
| `sequence` | 必须从 1 开始且与数组位置连续一致 |

未知字段、错误 schemaVersion、空标题、超限内容或不连续 sequence 均视为非法审计。

### 5.2 非法审计处理

- RPC 结果本身仍正常完成，避免日志附属数据破坏业务调用。
- 服务端丢弃整个非法 `appAudit`，记录一条包含 `requestId` 的警告。
- `resultAck.outcome` 保持现有语义，不增加设备重试审计数据的隐式行为。
- Monitor 详情返回 `appAudit: null`。

## 6. 冷路径与存储

```text
HTTP invoke
  -> WS job
  -> Device result + appAudit
  -> RpcService 校验/规范化
  -> BullMQ RequestLogJob
  -> Worker
      -> PostgreSQL request_logs：标量脊柱，不存 appAudit
      -> Manticore request_logs：request/response payload + app_audit_json
  -> GET /monitor/requests/:requestId
      -> requestPayload + responsePayload + appAudit
```

Manticore 新建表直接包含 `app_audit_json text`。已有数据卷由 `SearchService.ensureTable()` 检查
`DESC request_logs` 后执行一次 `ALTER TABLE ... ADD COLUMN app_audit_json text`，不涉及 PostgreSQL 迁移。

旧日志和未上报审计的日志统一返回 `appAudit: null`。

## 7. 设备侧记录器行为

设备 SDK 应复用 FlowCore 的行为：

1. `start({ title, metadata })` 创建一次审计。
2. `beginStep()` 自动生成连续 `sequence`、`startedAt`，初始 `durationMs = 0`。
3. `complete()` 写入 response/status/duration。
4. `fail()` 写入 error、可选 response 和 duration。
5. 每个 Step 只允许完成一次。
6. 最终发送 `result` 时附带完整快照。

设备断线或整体超时且未发送最终 `result` 时，服务端只能记录 RPC 外围状态，无法获得设备内部 Step。

## 8. API 读取契约

`GET /monitor/requests/:requestId` 在原有字段上增加：

```json
{
  "payloadUnavailable": false,
  "requestPayload": {},
  "responsePayload": {},
  "appAudit": {
    "schemaVersion": 1,
    "title": "设备执行链路",
    "metadata": [],
    "steps": []
  }
}
```

无审计或 payload 不可用：

```json
{
  "appAudit": null
}
```

列表接口仍只返回 PostgreSQL 脊柱，不返回 payload 或 `appAudit`。

## 9. 验收标准

1. 旧设备不传 `appAudit`，invoke 和日志详情行为不回退，详情明确返回 `null`。
2. 设备通过真实 WS 返回包含成功 Step、失败 Step、headers/body 的合法 V1 审计。
3. HTTP invoke 返回正常业务 payload，但不额外暴露 `appAudit`。
4. Worker 完成后，只通过 Monitor HTTP API 能读取完全一致的审计结构。
5. 非法 sequence 或超限审计被丢弃，但对应 RPC 仍成功。
6. 请求日志列表不出现 `appAudit`。
7. Jest 覆盖 V1 校验边界；完整黑盒覆盖 HTTP → WS → Worker → Monitor。
8. `test/assert-blackbox-e2e.js` 继续确认 E2E 未直连任何持久层。
