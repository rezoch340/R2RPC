# 系统操作审计日志设计

> 状态：✅ 已实施并验证。
>
> 日期：2026-07-24。

## 1. 当前表字段盘点

当前 PostgreSQL 共 14 张表，不是每张表都有字面上的 `name` 和 `description`，也不应机械补齐：

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
2. 记录后台 JWT 用户在管理 API 中执行的所有业务写操作。
3. 每条日志能直接回答：谁、何时、做了什么、操作对象、结果、来源 IP。
4. 新增只读 `GET /system-logs`，支持筛选与分页。
5. 使用 `read/system-log` 授权；root 继续由全局权限守卫直通。
6. 不记录密码、token 明文或完整请求体。
7. 黑盒测试只通过 HTTP 产生和读取审计日志。

## 3. 非目标

- 不把系统操作日志混入 RPC `request_logs`。
- 不记录 RPC invoke、设备 WebSocket 消息或 AppAudit Step；它们已有独立日志链路。
- 不为关系表、请求日志和聚合表增加无业务意义的 `name`。
- 首版不提供系统日志修改、删除或清理 API。
- 首版不记录在进入 controller 前就被 Guard 拒绝的请求；记录已通过鉴权和权限守卫的业务操作结果。

## 4. 数据模型

`system_logs`：

| 字段 | 含义 |
|---|---|
| `id` | 递增主键 |
| `name` | 操作名称，例如“创建用户” |
| `description` | 人类可读摘要，例如“admin 创建用户 alice” |
| `actor_user_id` | 操作者用户编号 |
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

后台 mutation 显式增加 `@SystemAudit(...)` 元数据，全局 `SystemAuditInterceptor` 只处理带该元数据
的方法：

1. controller 成功返回后，等待审计记录写入，再把业务响应返回客户端。
2. controller/service 抛错时记录 failed 和 HTTP 状态，然后原样抛出业务错误。
3. 审计存储失败只记服务端 error，不把已经成功的业务操作伪装成失败。
4. 只从装饰器声明的 path/body 字段构建 metadata，禁止复制完整 body。
5. `password`、access token、device token 永远不进入日志。

该方式比根据 URL 写大段 `if/else` 更可读；新增写端点时必须显式声明操作名称与安全字段。

## 6. 查询 API

```http
GET /system-logs
```

权限：`read/system-log`。

可选参数：

- `actorUsername`
- `action`
- `subject`
- `status`
- `from` / `to`
- `page`，默认 1
- `pageSize`，默认 20，最大 200

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
  "pageSize": 20,
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
3. 创建用户后可立即通过 HTTP 查询到“admin 创建用户 xxx”。
4. 修改密码不会在系统日志响应中出现密码。
5. 系统日志没有修改和删除 API。
6. 普通用户必须具有 `read/system-log` 才能查询。
7. build、命名/复杂度门禁、Jest、OpenAPI 和完整 HTTP/WS 黑盒全部通过。

## 9. 实施结果

- 新增 `system_logs` 后 Drizzle 识别 15 张表；迁移总数为 9。
- 种子权限 18 条，operator 的 `read/*` 权限 8 条。
- OpenAPI 导出 35 个 HTTP 路径模板。
- Jest 7 个 suite、17 个测试全部通过。
- 隔离 PostgreSQL/Redis/Manticore + API + Worker 环境中，完整黑盒
  `139 passed, 0 failed`。
- E2E 边界守卫确认测试只访问 HTTP/WebSocket；build、lint 和 Prettier check 全部通过。
