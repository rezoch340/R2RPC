# R2RPC 当前核心功能统计

> 更新日期：2026-07-25。本文统计当前 NestJS/PostgreSQL 实现。旧 Go 系统语义基线见 `docs/archive/旧版-Go-核心功能统计.md`。

## 1. 完成度

后端既定 backlog #1–#15 与管理前端 #16、手动 RPC 调试 #17、后台授权缓存 #18、统一配置与
完整 Compose #19、容器性能测试 #20、Android 与 JavaScript SDK #21、GitHub Actions #22
全部完成。代码包含 39 个 HTTP
路径模板、1 个设备 WebSocket 网关、API/Worker 双进程、15 张 PostgreSQL 表、11 个数据库
迁移和 10 个管理页面。

| 领域 | 能力 | 状态 | 黑盒覆盖 |
|---|---|---|---|
| 认证 | 登录、JWT、`/auth/me`、60 秒授权快照 cache-aside | ✅ | ✅ |
| RBAC | 权限组、嵌套权限、用户分组、19 条带说明权限、root-only 写隔离、写后缓存失效 | ✅ | ✅ |
| 用户 | CRUD、资料、改密、enabled、管理员隔离、旧 JWT 吊销 | ✅ | ✅ |
| 系统审计 | 谁在何时做了什么、安全 metadata、筛选分页 | ✅ | ✅ |
| Project | CRUD、enabled、GroupInfo | ✅ | ✅ |
| Access token | `rk_`、project/时间/次数二次编辑、原子计数、过期/撤销/软删、缓存失效 | ✅ | ✅ |
| Device token | `dk_`、无过期时间、project 作用域二次编辑、旧连接断开、撤销/软删 | ✅ | ✅ |
| 设备 | WS 自注册、持久态、列表/详情、stale | ✅ | 公开面 ✅ |
| RPC | 公开调用、后台手动调试、轮询、指定设备、成功/失败/超时/无设备/离线 | ✅ | ✅ |
| 限流 | `[256,1024]` maxInFlight、跳过满设备、rejected | ✅ | ✅ |
| WS 健壮性 | ping、20 秒读超时、4 MiB、拒分片、deadline | ✅ | ✅ |
| 日志 | PG 脊柱、Manticore payload/AppAudit、筛选、详情 | ✅ | ✅ |
| 设备审计 | AppAudit V1 metadata、成功/失败 Step、输入隔离 | ✅ | ✅ |
| 日志保留 | 按天清理、每 scope 留最新 N 条 | ✅ | 内部集成 |
| 指标 | 日聚合、重建、清理、overview/weekly/trend | ✅ | 公开读面 ✅ |
| 分布式 | Redis session/waiter/pub-sub/结果去重 | ✅ | 单实例闭环 ✅ |
| OpenAPI | 39 路径 / 52 操作、双鉴权、成功与错误响应契约 | ✅ | 生成期完整性断言 |
| 代码质量 | 完整变量名、复杂度/嵌套/函数长度门禁 | ✅ | `pnpm lint:check` |
| 管理前端 | Next.js + shadcn，完整后台公开面 | ✅ | Playwright 12 项 + HTTP |
| 前端质量 | 页面/组件/E2E 完整变量名门禁、ESLint、生产构建 | ✅ | `frontend/pnpm lint` |
| 配置与部署 | 前后端统一 YAML、API/Worker/frontend 镜像、完整 Compose | ✅ | loader 单测 + Compose/build |
| 部署安全 | 运行时 OpenAPI 开关、Swagger 无关 TCP 健康检查、生产配置基线 | ✅ | config + Compose |
| 性能验收 | 4 台在线虚拟设备、真实 WS Hello、自动/随机路由、质量阈值、JSON 报告 | ✅ | 受限 Compose 实测 |
| 官方 SDK | Android/Kotlin 与 JavaScript/TypeScript 设备端、调用方、AppAudit Recorder | ✅ | 18 项 SDK 测试 |
| CI 与镜像发布 | 后端/前端质量门禁、Compose 黑盒、`v*` 标签发布 GHCR | ✅ | GitHub Actions |

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
当前 19 条内置权限都带完整说明，`seed-admin.ts` 会在幂等重跑时同步更新历史权限说明。
手动调试单独使用 `invoke/manual-rpc`，不会借用 `invoke/rpc` 或 Access Token 管理权限。
JWT 鉴权通过公共 Redis cache-aside 读取用户身份与权限快照；未命中或 Redis 异常时回源
PostgreSQL 并回写。权限组/权限关系、用户分组、账号启停和软删除成功后立即删除受影响用户缓存。

### System logs

- `GET /system-logs`

要求 `read/system-log`，支持
`name/actorUsername/action/subject/targetType/targetName/status/from/to/page/pageSize`。
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
- `PATCH /access-tokens/:id`
- `PATCH /access-tokens/:id/projects`
- `POST /access-tokens/:id/revoke`
- `DELETE /access-tokens/:id`
- `GET|POST /device-tokens`
- `PATCH /device-tokens/:id/projects`
- `POST /device-tokens/:id/revoke`
- `DELETE /device-tokens/:id`

Access Token 的新建与完整编辑接口支持可选 `expiresAt` 和 `maximumUsageCount`；`null` 表示
取消对应限制，修改不会重置 `usageCount`。只有通过鉴权与参数校验的公开 RPC invoke 消耗
一次次数，clientQueue 不消耗；进入业务层后无论最终成功、无设备、设备错误或超时都计数。
次数受限令牌使用 PostgreSQL 条件更新原子占用额度，达到上限返回 `429`；不限次数令牌不写
累计值。

### Devices / RPC

- `GET /devices`
- `GET /devices/:id`
- `GET /rpc/debug/options`
- `POST /rpc/debug/invoke/:project/:action`
- `POST /rpc/invoke/:project/:action`
- `GET /rpc/clientQueue`

`/rpc/debug/*` 使用后台 JWT 和 `invoke/manual-rpc`。上下文接口返回功能组、历史 Action 与在线
设备；调用接口复用真实 RPC 派发链路，把发起用户写入请求日志，并写不含 Payload 的系统审计。
公开 `/rpc/invoke/*` 和 `/rpc/clientQueue` 继续只接受 Access Token。

### Monitor / Metrics

- `GET /monitor/requests`
- `GET /monitor/request-options`
- `GET /monitor/requests/:requestId`
- `GET /metrics/overview`
- `GET /metrics/weekly`
- `GET /metrics/trend`

请求列表支持
`project/action/clientId/status/payloadState/minimumLatencyMs/maximumLatencyMs/from/to/page/pageSize`；
系统日志与请求日志的 `pageSize` 都默认 10、最大 100。

完整 schema 见 `docs/openapi.yaml`。

### 管理前端路由

| 路由 | 后端公开接口 |
|---|---|
| `/` | `/metrics/overview`、`/metrics/trend`、`/projects/info`、`/devices` |
| `/projects` | `/projects`、`/projects/info`、启停与删除 |
| `/devices` | `/devices` |
| `/access-tokens` | `/access-tokens`、`PATCH /access-tokens/:id`、`/projects` |
| `/device-tokens` | `/device-tokens`、`PATCH /device-tokens/:id/projects`、`/projects` |
| `/request-logs` | `/monitor/requests`、`/monitor/request-options`、`/monitor/requests/:requestId` |
| `/rpc-debugger` | `/rpc/debug/options`、`/rpc/debug/invoke/:project/:action` |
| `/users` | `/users`、`/rbac/users/:userId/roles` |
| `/permission-groups` | `/rbac/roles`、`/rbac/permissions` 与关联接口 |
| `/system-logs` | `/system-logs` |

前端使用后台 JWT，按 `permissions` 和 `isRoot` 控制入口显隐；后端 Guard 始终执行真实授权。
用户本人可从账号菜单改密，root 账号仍只允许本人修改。请求详情按需加载 Manticore payload 和
AppAudit Step，列表不携带大字段。运行概览使用近 7 天折线趋势图；请求详情为宽版右侧抽屉，
所有 AppAudit Step 默认收起。令牌与 JSON 载荷统一使用 `CopyButton`，Clipboard API
不可用或被拒绝时自动回退。手动 RPC 页可选择功能组、历史 Action、在线设备和超时，格式化
Payload，并排查看原始请求、响应、业务状态和耗时；重复调用等待期间保留上一份结果，操作
按钮不改变文案、尺寸、位置和不透明度；页面入口由 `invoke/manual-rpc` 控制。

### 统一配置与部署

- 根目录 `config.example.yaml` 是宿主机模板；`deploy/config.example.yaml` 使用相同 schema，
  仅把基础设施主机改为 Compose 服务名。
- API、Worker、Drizzle、迁移、种子和前端只读取 `config.yaml`；`CONFIG_FILE` 仅选择文件。
- CORS、前端 API、开发来源和种子管理员已从分散环境变量迁入
  `app/frontend/bootstrap` 配置段。
- 根目录 `compose.yaml` 编排 PostgreSQL、Redis、Manticore、migration、seed、API、
  Worker 与 frontend，并使用健康检查和一次性任务完成条件控制启动顺序。
- `backend/Dockerfile` 与 `frontend/Dockerfile` 均生成非 root 生产镜像；统一配置只读挂载。
- `performance` profile 使用同一后端镜像挂载虚拟 WS 设备并执行一次性公开接口压测；全部
  Compose 服务声明 CPU/内存/PID 上限，合计 4.00 核和 3840 MiB。

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

- device token 无效、撤销或软删：close `4001`；凭证本身不设置过期时间
- device token project 作用域更新：现有连接 close `4002`，重连后继承新作用域
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
- `system_logs`
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
- `ws:device-token-scope-changed` 集群事件频道
- BullMQ 队列与其他 Redis pub/sub

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

### 单元测试

- Jest 10 suites / 35 tests。
- 统一配置 loader 覆盖父目录查找、`CONFIG_FILE` 显式选择、schema 默认值和非法配置拒绝。
- 公共 Redis cache-aside 覆盖命中、持久层 fallback 与回写、负缓存、契约异常失效、
  写后删除和写失败不删缓存。

### 黑盒 E2E

`pnpm smoke` 与 `pnpm test:e2e` 执行同一套完整性测试：

- 180 项运行时检查，0 项直接访问数据库、Redis 或 Manticore。
- 覆盖全部 HTTP controller 方法。
- 覆盖系统操作日志、筛选、普通用户权限委派和密码不泄露。
- 覆盖权限组编辑、嵌套权限、用户已分配组、新旧关联入口和 root-only 写隔离。
- 覆盖缓存命中后的权限挂载/移除、权限删除、用户分组/移组、启停和软删除实时生效。
- 覆盖资料修改、改密新旧密码登录，以及管理员资料/密码/启停/删除/RBAC 关系隔离。
- 覆盖两类令牌二次编辑功能组、Access Token 时间/次数策略、并发原子计数、额度用尽 `429`、
  缓存失效和 Device Token 旧作用域连接断开重连。
- 覆盖全部内置权限说明、手动 RPC 权限拒绝/放行、上下文、真实 WS 往返、系统审计和后台
  发起人溯源。
- 覆盖 WS 鉴权、心跳、ping、读超时、分片/超大帧拒绝。
- 使用 256 个并发 HTTP invoke 真实占满 WS 设备在途槽。
- 覆盖目标设备 result 身份匹配与重复结果去重。
- 覆盖设备上报成功/失败 Step、非法 sequence 隔离和 Monitor API 读取。
- 通过 monitor/metrics API 验证 Worker 冷路径结果。

`test/assert-blackbox-e2e.js` 会静态拒绝 E2E 或性能执行器导入持久层客户端或应用内部服务。

前端 `test/assert-blackbox-e2e.cjs` 使用同一口径，Playwright 当前 12 项，只操作浏览器和公开
HTTP API；覆盖全部管理页、手动 RPC 调试、字段筛选与分页、两类令牌作用域编辑、Access
Token 时间/次数策略编辑、非安全上下文复制回退、日志详情抽屉、账号改密入口、移动导航、
导航预取和未登录跳转。测试不会导入后端、
数据库或 Redis。
前端 `test/assert-readable-source.cjs` 覆盖页面、组件和 E2E。

Jest 当前为 10 个 suite、35 个测试，包含统一配置加载、公共 Redis cache-aside、系统审计
推导、登录/读取/拒绝访问、摘要/白名单/失败结果/无请求体回归、管理员策略分支以及
RootGuard 的 root、非 root `manage/rbac` 和缺失身份分支。

### 内部集成

以下命令直接构造底层状态，因此明确不是 E2E：

- `pnpm test:integration:retention`
- `pnpm test:integration:device-stale`
- `pnpm test:integration:metrics`
- `pnpm test:integration:max-inflight`

### 性能测试

- `pnpm performance` 在宿主机读取统一配置并只访问公开 HTTP/WebSocket。
- `docker compose --profile performance run --rm performance` 在受限容器内执行相同测试。
- 默认挂载 4 台设备；10 个混合场景覆盖 7 个控制面读取、手动自动路由 Hello、
  Access Token 自动轮询 Hello 和随机指定设备 Hello。
- 默认 3 秒预热、20 秒计量、16 并发、80 req/s；错误率、P95、最小吞吐和全部设备覆盖均为
  强制阈值。
- 隔离 Compose 实测 1600 请求、0 失败、80.03 req/s、P95 7.50 ms、P99 10.31 ms；
  3 个 Hello 场景各 160 次，4 台设备全部收到任务。

### Android 与 JavaScript SDK

- JavaScript SDK：`sdk/javascript/`，ESM + TypeScript 声明，Node.js 20+ 和现代浏览器可用。
- Android SDK：`sdk/android/`，Maven 坐标
  `io.r2rpc:r2rpc-android:0.1.0`，`minSdk 21`、Java 8 字节码兼容 AAR，设备默认
  使用 Widevine MediaDrm ID 作为 `clientId`。
- 两端同时提供 Device 与 Caller：设备端封装 WS welcome、heartbeat、重连、Action
  路由/超时/result；调用方封装 invoke、在线设备列表和指定设备在线状态。
- 两端提供 AppAudit V1 Recorder，自动生成连续 sequence、ISO 时间与 duration，并拒绝
  Step 重复完成。
- JavaScript Vitest 10 项、Android/JUnit 8 项通过；Android MockWebServer 使用真实
  HTTP/WebSocket 帧验证公开协议。

## 8. 剩余工作

- CI
- 专用健康检查/readiness
- Kubernetes、生产 secret 与统一反向代理
