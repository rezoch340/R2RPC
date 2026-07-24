# 系统操作审计日志设计

> 状态：✅ 已实施并验证。
>
> 日期：2026-07-24。

## 1. 当前表字段盘点

新增 `system_logs` 前 PostgreSQL 共 14 张表。原有表不是每张都有字面上的 `name` 和
`description`，也不应机械补齐：

| 类型 | 表 | 名称语义 | description |
|---|---|---|---|
| 业务实体 | `projects`、`roles`、`access_tokens`、`device_tokens` | `name` | 有 |
| 业务实体 | `users` | `username` | 有 |
| 业务实体 | `devices` | `client_id` | 有 |
| 权限目录 | `permissions` | `action + subject` | 有 |
| 关系表 | `access_token_projects`、`device_token_projects`、`role_permissions`、`user_roles` | 复合外键，不需要 name | 有 |
| 请求日志 | `request_logs` | `request_id` | 无，按日志表规则豁免 |
| 派生聚合 | `device_daily_metrics`、`rpc_daily_metrics` | 复合统计维度 | 无，按派生表规则豁免 |

结论：

- 所有业务实体已经同时具有“语义名称”和 `description`。
- 关系表已有 `description`，名称由两端实体决定，增加独立 `name` 会制造重复且可漂移的数据。
- 请求日志和聚合表不是可命名实体，不增加无意义的 `name/description`。
- 新增的系统审计日志为了直接展示“某某某干了什么”，明确包含 `name` 与 `description`。

## 2. 目标

1. 新增不可由 HTTP 修改或删除的 `system_logs` 追加型审计表。
2. 记录登录成功/失败、后台 JWT 用户的全部控制面读取、Guard/路由阶段拒绝和业务写操作。
3. 每条日志能直接回答：谁、何时、做了什么、操作对象、结果、来源 IP。
4. 新增只读 `GET /system-logs`，支持事件、操作者、动作、资源、目标、结果、时间筛选与分页。
5. 使用 `read/system-log` 授权；root 继续由全局权限守卫直通。
6. 不记录密码、token 明文或完整请求体。
7. 黑盒测试只通过 HTTP 产生和读取审计日志。

## 3. 非目标

- 不把系统操作日志混入 RPC `request_logs`。
- 不记录公开 Access Token RPC、设备 WebSocket 消息或 AppAudit Step；它们已有独立日志链路。
- 不为关系表、请求日志和聚合表增加无业务意义的 `name`。
- 首版不提供系统日志修改、删除或清理 API。
- 不把 Swagger 静态资源、公开 RPC invoke 或设备 WebSocket 数据面流量写入系统日志。

## 4. 数据模型

`system_logs`：

| 字段 | 含义 |
|---|---|
| `id` | 递增主键 |
| `name` | 操作名称，例如“创建用户” |
| `description` | 人类可读摘要，例如“admin 创建用户 alice” |
| `actor_user_id` | 操作者用户编号；登录失败等匿名阶段为 0 |
| `actor_username` | 操作者用户名快照，用户以后改名/删除仍可取证 |
| `action` / `subject` | 结构化动作和资源 |
| `target_type` / `target_id` / `target_name` | 操作对象快照 |
| `metadata` | 由装饰器白名单选择的安全字段 |
| `method` / `route` | HTTP 方法和不含 query 的路径 |
| `status` / `status_code` / `error_message` | succeeded/failed 与结果 |
| `ip_address` / `user_agent` | 请求来源 |
| `created_at` | 操作时间 |

表是不可变审计事实，不加 `deleted_at`，不提供 update/delete service。

## 5. 记录方式

后台 mutation 显式增加 `@SystemAudit(...)` 元数据；登录显式声明安全操作者字段。全局
`SystemAuditInterceptor` 对没有显式定义的 JWT 控制面读取自动推导资源和动作：

1. controller 成功返回后，等待审计记录写入，再把业务响应返回客户端。
2. controller/service 抛错时记录 failed 和 HTTP 状态，然后原样抛出业务错误。
3. Guard 或路由阶段在拦截器执行前失败时，由依赖注入的全局异常过滤器补记；请求级标记避免重复。
4. 审计存储失败只记服务端 error，不把已经成功的业务操作伪装成失败。
5. 只从声明的安全 path/body/query 字段构建 metadata，禁止复制完整 body。
6. `password`、access token、device token 永远不进入日志。
7. 公开 RPC invoke、设备 WS 和 AppAudit 继续走请求日志/协议日志，不重复进入控制面审计。
   后续新增的后台 JWT 手动 RPC 属于低频控制面操作，另写不含 Payload 的白名单审计。

自动推导使用一张控制面资源表和 HTTP 方法映射，不写长 `if/else`；新增写端点仍必须显式声明
操作名称与安全字段。

## 6. 查询 API

```http
GET /system-logs
```

权限：`read/system-log`。

可选参数：

- `name`
- `actorUsername`
- `action`
- `subject`
- `targetType`
- `targetName`
- `status`
- `from` / `to`
- `page`，默认 1
- `pageSize`，默认 10，最大 100

响应：

```json
{
  "rows": [
    {
      "id": 1,
      "name": "创建用户",
      "description": "admin 创建用户 alice",
      "actorUserId": 1,
      "actorUsername": "admin",
      "action": "create",
      "subject": "user",
      "targetType": "user",
      "targetId": "2",
      "targetName": "alice",
      "metadata": {},
      "method": "POST",
      "route": "/users",
      "status": "succeeded",
      "statusCode": 201,
      "errorMessage": null,
      "createdAt": "2026-07-24T12:00:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 10,
  "total": 1
}
```

## 7. 索引与保留

- `(created_at, id)`：稳定倒序分页。
- `(actor_username, created_at)`：按操作者筛选。
- `(subject, action, created_at)`：按资源动作筛选。
- `(status, created_at)`：按成功/失败筛选。

首版永久保留；后续如需清理，只能增加独立运维策略，不能提供普通后台删除接口。

## 8. 验收标准

1. 迁移后共 15 张 PostgreSQL 表。
2. 用户、project、token、权限组和权限关系的后台 mutation 均声明系统审计。
3. 登录成功、登录失败、读取具体账号和 Guard 拒绝均可通过 HTTP 查询。
4. 创建用户后可立即通过 HTTP 查询到“admin 创建用户 xxx”。
5. 登录和修改密码日志均不会出现密码或 token。
6. 系统日志没有修改和删除 API。
7. 普通用户必须具有 `read/system-log` 才能查询。
8. build、命名/复杂度门禁、Jest、OpenAPI 和完整 HTTP/WS 黑盒全部通过。

## 9. 实施结果

- 新增 `system_logs` 后 Drizzle 识别 15 张表；迁移总数为 9。
- 种子权限 19 条且全部带完整说明，operator 的 `read/*` 权限 8 条。
- OpenAPI 导出 39 个 HTTP 路径模板。
- Jest 8 个 suite、24 个测试全部通过。
- 隔离 PostgreSQL/Redis/Manticore + API + Worker 环境中，完整黑盒
  `162 passed, 0 failed`。
- E2E 边界守卫确认测试只访问 HTTP/WebSocket；build、lint 和 Prettier check 全部通过。
