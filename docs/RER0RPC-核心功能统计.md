# RER0RPC 当前核心功能统计

> 更新日期：2026-07-24。本文统计当前 NestJS/PostgreSQL 实现。旧 Go 系统语义基线见 `docs/archive/旧版-Go-核心功能统计.md`。

## 1. 完成度

后端既定 backlog #1–#15 与管理前端 #16 全部完成。代码包含 37 个 HTTP 路径模板、1 个设备
WebSocket 网关、API/Worker 双进程、15 张 PostgreSQL 表、9 个数据库迁移和 9 个管理页面。

| 领域 | 能力 | 状态 | 黑盒覆盖 |
|---|---|---|---|
| 认证 | 登录、JWT、`/auth/me` | ✅ | ✅ |
| RBAC | 权限组、嵌套权限、用户分组、root-only 写隔离 | ✅ | ✅ |
| 用户 | CRUD、资料、改密、enabled、管理员隔离、旧 JWT 吊销 | ✅ | ✅ |
| 系统审计 | 谁在何时做了什么、安全 metadata、筛选分页 | ✅ | ✅ |
| Project | CRUD、enabled、GroupInfo | ✅ | ✅ |
| Access token | `rk_`、project 作用域二次编辑、过期/撤销/软删、缓存失效 | ✅ | ✅ |
| Device token | `dk_`、project 作用域二次编辑、旧连接断开、过期/撤销/软删 | ✅ | ✅ |
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
| 管理前端 | Next.js + shadcn，完整后台公开面 | ✅ | Playwright + HTTP |
| 前端质量 | 页面/组件/E2E 完整变量名门禁、ESLint、生产构建 | ✅ | `frontend/pnpm lint` |

## 2. HTTP API

### Auth

- `POST /auth/login`
- `GET /auth/me`

### Users

- `GET /users`
- `GET /users/:id`
- `POST /users`
- `PATCH /users/:id`
- `PATCH /users/:id/password`
- `DELETE /users/:id`
- `POST /users/:id/enabled`

`isRoot` 种子管理员账号只能由本人修改。该保护同时覆盖资料、密码、启停、软删除以及两种
用户权限组绑定/解绑入口。`users.role` 不参与授权或管理员保护。

### RBAC

- `GET|POST /rbac/roles`
- `PATCH|DELETE /rbac/roles/:id`
- `GET|POST /rbac/permissions`
- `DELETE /rbac/permissions/:id`
- `POST /rbac/roles/:roleId/permissions`（请求体形式）
- `POST|DELETE /rbac/roles/:roleId/permissions/:permissionId`
- `GET|POST /rbac/users/:userId/roles`（查询/请求体分配）
- `POST|DELETE /rbac/users/:userId/roles/:roleId`

`roles` 即权限组，一个用户可拥有多个权限组，最终权限取所有有效组的并集。三个读入口要求
`read/rbac`；所有 RBAC 写入口要求 `manage/rbac` 并叠加 `RootGuard`，只有种子管理员可执行。
普通账号即使被授予 `manage/rbac` 仍不能修改权限组、权限目录或用户分组。

### System logs

- `GET /system-logs`

要求 `read/system-log`，支持 `actorUsername/action/subject/status/from/to/page/pageSize`。
`system_logs` 只追加、不软删，没有修改和删除 API；记录登录成功/失败、控制面读取、
Guard/路由阶段拒绝和后台 mutation。mutation 通过显式 `@SystemAudit` 保留准确业务语义；
metadata 只包含安全白名单字段，不保存密码或 token 明文。RPC/WS 数据面不重复写入。

### Project

- `GET|POST /projects`
- `GET /projects/info`
- `DELETE /projects/:id`
- `POST /projects/:id/enabled`

### Tokens

- `GET|POST /access-tokens`
- `PATCH /access-tokens/:id/projects`
- `POST /access-tokens/:id/revoke`
- `DELETE /access-tokens/:id`
- `GET|POST /device-tokens`
- `PATCH /device-tokens/:id/projects`
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

### 管理前端路由

| 路由 | 后端公开接口 |
|---|---|
| `/` | `/metrics/overview`、`/metrics/trend`、`/projects/info`、`/devices` |
| `/projects` | `/projects`、`/projects/info`、启停与删除 |
| `/devices` | `/devices` |
| `/access-tokens` | `/access-tokens`、`/projects` |
| `/device-tokens` | `/device-tokens`、`/projects` |
| `/request-logs` | `/monitor/requests`、`/monitor/requests/:requestId` |
| `/users` | `/users`、`/rbac/users/:userId/roles` |
| `/permission-groups` | `/rbac/roles`、`/rbac/permissions` 与关联接口 |
| `/system-logs` | `/system-logs` |

前端使用后台 JWT，按 `permissions` 和 `isRoot` 控制入口显隐；后端 Guard 始终执行真实授权。
用户本人可从账号菜单改密，root 账号仍只允许本人修改。请求详情按需加载 Manticore payload 和
AppAudit Step，列表不携带大字段。

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

- 155 项运行时检查，0 项直接访问数据库、Redis 或 Manticore。
- 覆盖全部 HTTP controller 方法。
- 覆盖系统操作日志、筛选、普通用户权限委派和密码不泄露。
- 覆盖权限组编辑、嵌套权限、用户已分配组、新旧关联入口和 root-only 写隔离。
- 覆盖资料修改、改密新旧密码登录，以及管理员资料/密码/启停/删除/RBAC 关系隔离。
- 覆盖两类令牌二次编辑功能组、Access Token 缓存失效和 Device Token 旧作用域连接断开重连。
- 覆盖 WS 鉴权、心跳、ping、读超时、分片/超大帧拒绝。
- 使用 256 个并发 HTTP invoke 真实占满 WS 设备在途槽。
- 覆盖目标设备 result 身份匹配与重复结果去重。
- 覆盖设备上报成功/失败 Step、非法 sequence 隔离和 Monitor API 读取。
- 通过 monitor/metrics API 验证 Worker 冷路径结果。

`test/assert-blackbox-e2e.js` 会静态拒绝 E2E 导入持久层客户端或应用内部服务。

前端 `test/assert-blackbox-e2e.cjs` 使用同一口径，Playwright 只操作浏览器和公开 HTTP API；
不会导入后端、数据库或 Redis。前端 `test/assert-readable-source.cjs` 覆盖页面、组件和 E2E。

Jest 当前为 8 个 suite、24 个测试，包含系统审计推导、登录/读取/拒绝访问、
摘要/白名单/失败结果/无请求体回归、管理员策略分支以及
RootGuard 的 root、非 root `manage/rbac` 和缺失身份分支。

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
