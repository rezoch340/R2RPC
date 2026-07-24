# RER0RPC 当前核心功能统计

> 更新日期：2026-07-24。本文统计当前 NestJS/PostgreSQL 实现。旧 Go 系统语义基线见 `docs/archive/旧版-Go-核心功能统计.md`。

## 1. 完成度

后端既定 backlog #1–#12 全部完成。代码包含 31 个 HTTP 路径模板、1 个设备 WebSocket 网关、API/Worker 双进程和 8 个数据库迁移。

| 领域 | 能力 | 状态 | 黑盒覆盖 |
|---|---|---|---|
| 认证 | 登录、JWT、`/auth/me` | ✅ | ✅ |
| RBAC | role/permission CRUD 与双向解绑 | ✅ | ✅ |
| 用户 | CRUD、enabled、lastLoginAt、旧 JWT 吊销 | ✅ | ✅ |
| Project | CRUD、enabled、GroupInfo | ✅ | ✅ |
| Access token | `rk_`、project 作用域、过期/撤销/软删 | ✅ | ✅ |
| Device token | `dk_`、project 绑定、过期/撤销/软删 | ✅ | ✅ |
| 设备 | WS 自注册、持久态、列表/详情、stale | ✅ | 公开面 ✅ |
| RPC | 轮询、指定设备、成功/失败/超时/无设备/离线 | ✅ | ✅ |
| 限流 | `[256,1024]` maxInFlight、跳过满设备、rejected | ✅ | ✅ |
| WS 健壮性 | ping、20 秒读超时、4 MiB、拒分片、deadline | ✅ | ✅ |
| 日志 | PG 脊柱、Manticore payload/AppAudit、筛选、详情 | ✅ | ✅ |
| 设备审计 | AppAudit V1 metadata、成功/失败 Step、输入隔离 | ✅ | ✅ |
| 日志保留 | 按天清理、每 scope 留最新 N 条 | ✅ | 内部集成 |
| 指标 | 日聚合、重建、清理、overview/weekly/trend | ✅ | 公开读面 ✅ |
| 分布式 | Redis session/waiter/pub-sub/结果去重 | ✅ | 单实例闭环 ✅ |
| OpenAPI | 规范导出与生成脚本 | ✅ | build 校验 |
| 代码质量 | 完整变量名、复杂度/嵌套/函数长度门禁 | ✅ | `pnpm lint:check` |

## 2. HTTP API

### Auth

- `POST /auth/login`
- `GET /auth/me`

### Users

- `GET /users`
- `GET /users/:id`
- `POST /users`
- `DELETE /users/:id`
- `POST /users/:id/enabled`

### RBAC

- `GET|POST /rbac/roles`
- `DELETE /rbac/roles/:id`
- `GET|POST /rbac/permissions`
- `DELETE /rbac/permissions/:id`
- `POST|DELETE /rbac/roles/:roleId/permissions/:permissionId`
- `POST|DELETE /rbac/users/:userId/roles/:roleId`

### Project

- `GET|POST /projects`
- `GET /projects/info`
- `DELETE /projects/:id`
- `POST /projects/:id/enabled`

### Tokens

- `GET|POST /access-tokens`
- `POST /access-tokens/:id/revoke`
- `DELETE /access-tokens/:id`
- `GET|POST /device-tokens`
- `POST /device-tokens/:id/revoke`
- `DELETE /device-tokens/:id`

### Devices / RPC

- `GET /devices`
- `GET /devices/:id`
- `POST /rpc/invoke/:project/:action`
- `GET /rpc/clientQueue`

### Monitor / Metrics

- `GET /monitor/requests`
- `GET /monitor/request-options`
- `GET /monitor/requests/:requestId`
- `GET /metrics/overview`
- `GET /metrics/weekly`
- `GET /metrics/trend`

完整 schema 见 `docs/openapi.yaml`。

## 3. WebSocket 协议

连接：

```text
GET /api/client/ws?token=<dk_...>&clientId=<device-id>&platform=<optional>&extra=<optional>&maxInFlight=<optional>
```

### Server → Device

```json
{
  "type": "welcome",
  "clientId": "device-001",
  "projects": [1],
  "maxInFlight": 512
}
```

```json
{
  "type": "job",
  "requestId": "uuid",
  "project": "cn-nodes",
  "action": "echo",
  "payload": {},
  "timeoutSeconds": 20,
  "deadlineAt": 1784890000000
}
```

### Device → Server

```json
{ "type": "heartbeat" }
```

```json
{
  "type": "result",
  "requestId": "uuid",
  "clientId": "device-001",
  "status": "ok",
  "is_ok": true,
  "payload": {},
  "appAudit": {
    "schemaVersion": 1,
    "title": "设备执行链路",
    "metadata": [],
    "steps": [
      {
        "sequence": 1,
        "name": "查询上游",
        "startedAt": "2026-07-24T12:00:00.000Z",
        "durationMs": 35,
        "status": 200
      }
    ]
  }
}
```

服务端使用 socket 已鉴权身份校验 result 来源，不采信消息体中的 `clientId`。
`appAudit` 可选；服务端校验通过后只进入请求日志，不透传给同步 invoke 调用方。完整契约见
`docs/device-app-audit.md`。

### 约束

- device token 无效、过期、撤销或软删：close `4001`
- 单帧大于 4 MiB：close `1009`
- 数据分片 `FIN=0`：close `1009`
- 每 5 秒服务端 ping
- 20 秒无 message/pong：terminate
- `maxInFlight` 默认 512，夹取到 `[256,1024]`
- `appAudit` 最大 512 KiB、64 metadata、128 Step，sequence 必须从 1 连续递增
- 非法 `appAudit` 整体丢弃，但 RPC 结果继续处理

## 4. RPC 状态

| 状态 | `httpCode` 字段 | 含义 |
|---|---:|---|
| `ok` | 设备回传 | 成功 |
| `error` | 设备回传或 503 | 设备失败/基础设施异常 |
| `timeout` | 504 | 等待设备超时 |
| `no_device` | 503 | project 内没有在线设备 |
| `offline` | 503 | 指定设备不在线 |
| `unavailable` | 503 | session 存在但 socket 不可用 |
| `rejected` | 429 | 设备或 project 全部在途槽已满 |
| `disabled` | 403 | project 已停用 |
| `no_project` | 404 | service 层不存在 project |

Controller 当前以正常 JSON 响应返回业务结果，业务 HTTP 码位于响应 `httpCode` 字段；鉴权和 DTO 错误使用实际 HTTP 401/403/400。

## 5. 存储

### PostgreSQL

- `users`
- `projects`
- `roles` / `permissions` / `user_roles` / `role_permissions`
- `access_tokens` / `access_token_projects`
- `device_tokens` / `device_token_projects`
- `devices`
- `request_logs`
- `device_daily_metrics`
- `rpc_daily_metrics`

### Redis

- `presence:{clientId}`
- `project:clients:{projectId}`
- `client:session:{clientId}`
- `rpc:waiter:{requestId}`
- `rpc:completed:{requestId}`
- `rpc:rr:{projectId}`
- `device:maxinflight:{clientId}`
- `device:inflight:{clientId}`
- BullMQ 队列与 Redis pub/sub

### Manticore

`request_logs` 搜索表保存请求/响应 payload 和 `app_audit_json`。PostgreSQL 列表只返脊柱，
详情按 `requestId` 懒加载 payload/AppAudit。旧日志或未上报审计的日志返回 `appAudit: null`。

## 6. 保留与指标

- 原始请求日志默认保留 3 天。
- 每 `(project, action, clientId)` 默认保留最新 100 条。
- 日聚合默认保留 30 天。
- Worker 启动时从最近原始日志重建日聚合。
- BullMQ 重试依靠 `requestId` 唯一和首插标志避免指标重复累计。

## 7. 测试统计

### 黑盒 E2E

`pnpm smoke` 与 `pnpm test:e2e` 执行同一套完整性测试：

- 121 项运行时检查，0 项直接访问数据库、Redis 或 Manticore。
- 覆盖全部 HTTP controller 方法。
- 覆盖 WS 鉴权、心跳、ping、读超时、分片/超大帧拒绝。
- 使用 256 个并发 HTTP invoke 真实占满 WS 设备在途槽。
- 覆盖目标设备 result 身份匹配与重复结果去重。
- 覆盖设备上报成功/失败 Step、非法 sequence 隔离和 Monitor API 读取。
- 通过 monitor/metrics API 验证 Worker 冷路径结果。

`test/assert-blackbox-e2e.js` 会静态拒绝 E2E 导入持久层客户端或应用内部服务。

### 内部集成

以下命令直接构造底层状态，因此明确不是 E2E：

- `pnpm test:integration:retention`
- `pnpm test:integration:device-stale`
- `pnpm test:integration:metrics`
- `pnpm test:integration:max-inflight`

## 8. 剩余工作

- CI
- 生产 API/Worker 镜像与编排
- 健康检查/readiness
- `clientId` 多租户隔离硬化
- `clientQueue?clientId=` project 边界硬化
- RBAC 短 TTL 缓存
