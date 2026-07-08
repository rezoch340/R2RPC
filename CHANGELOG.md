# Changelog

本项目重要改动记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/),语义化版本。

## [Unreleased]

### 已完成 · 阶段1 设备组一等实体(6/6)
- 设备组升为一等实体(FK);新增 `client_groups` 关联表,一个设备可属于多个组;`clients`/`devices` 去掉松散的 `group_name` 字符串。
- 设备登录改为按 `client_groups` 授权:组成员关系以库表为准,不再采信客户端自报的组;设备账号「建号 + 建组关联」走单事务并对组名去重。
- WS presence 按 group_id 多组登记,`rpc/invoke/:group/:action` 按组名解析 group_id 调度;跨实例 session/waiter/去重(dedup)走 Redis,分布式路由闭环。
- 迁移回填脚本(旧 `group_name` → `groups` + `client_groups`)作为生产参考。
- 种子脚本(`seed-admin.ts`)追加建 demo 组 `cn-nodes`/`us-nodes` + 多组设备 `dev-001`(幂等);端到端 smoke(登录 → WS 上线 → 心跳 → 多组 invoke → 超时 → 无分组)全绿,阶段1 收尾。
- 顺带修了个阶段1 遗留 bug:`ClusterBus` 的 redis 订阅连接原本建在 `onModuleInit` 里,但依赖方 `ConnectionRegistry` 在 `WsModule` 的 providers 数组里排在它前面,Nest 按声明顺序调 `onModuleInit` 导致订阅先于连接建好触发,API 进程必炸;改成在构造函数里建连接(`RedisService.client` 构造时已就绪),去掉这个初始化顺序依赖。

### 已完成 · 阶段2 后台 CASL RBAC(6/6)
- RBAC schema:`roles` / `permissions`(action+subject 唯一)/ `role_permissions` / `user_roles`;`users` 加 `is_root` 列;`users.role` 字符串字段保留但已废弃/失效,鉴权不再读它。
- `RbacService`:查用户全部有效权限(`user_roles → role_permissions → permissions` 去重)、`isRoot` 查询、用 `@casl/ability` 的 `AbilityBuilder` 把权限元组编译成 `can(action, subject)` 的 ability;角色/权限 CRUD + 角色-权限/用户-角色绑定。
- 全局 `PermissionGuard`(`APP_GUARD`,排在 `JwtAuthGuard` 之后)fail-closed:未标 `@RequirePermission` 的接口直接拒绝(防漏标);`isRoot` 用户绕过权限判断直通;其余按 CASL ability 校验。`JwtStrategy.validate` 登录态里预加载 `permissions` + `isRoot` 挂到 `request.user`。
- 所有后台接口(users/groups/clients/rpc/monitor/metrics/rbac/auth.me)补齐方法级 `@RequirePermission(action, subject)`,移除失效的旧 `@Roles`。
- RBAC 管理 API `/rbac/*`(角色/权限 CRUD + 角色绑权限 + 用户绑角色),以及 `/auth/me` 返回当前用户的 `permissions` 声明。
- 种子脚本(`seed-admin.ts`)追加:admin 置 `is_root=true`;建 14 条权限全集(user/group/client 的 read-create-delete、metrics/monitor/rpc 的 read、invoke/rpc、manage/rbac、read/me);建 `operator` 角色,只挂 7 条 `read/*` 权限,幂等可重跑。端到端 smoke 新增 RBAC 断言:未登录 401、admin(isRoot)全绿、operator 只读通过、operator 越权(create/user)403、`/auth/me` 带 `permissions` 数组 —— 全部通过,阶段2 收尾。

### 已完成 · 阶段3 invoke access token
- invoke/clientQueue 与用户 JWT/RBAC 彻底解耦:`@Public` 跳过全局 JWT/Permission 守卫,改由独立的 `AccessTokenGuard` 校验 Bearer access token(有效性 + 未过期 + `active` 状态 + `:group` 作用域),redis 缓存热路径(fail-open,任何 redis 异常回落 DB 不阻断鉴权)。
- Access token 后台管理 API `/access-tokens`(生成返回明文/列表/撤销),挂 `manage/access-token` 权限(admin isRoot 直通,operator 等只读角色不获得);`request_logs` 记 `access_token_id`,追踪每次 invoke 由哪个 token 发起。
- 种子脚本(`seed-admin.ts`)权限全集补上 `manage/access-token`(共 14 条),幂等可重跑。
- 端到端 smoke 的 invoke 断言全部改用 access token(不再传管理员 JWT,传了也会 401):同一设备跨组场景下验证「token 作用域命中」(cn-nodes 内 invoke 成功)、「越组 403」(设备本身也在 us-nodes,但 token 未开该组作用域,校验的是 token 而非设备)、「无效 token 401」、「无 Authorization 头 401」、「撤销后 403」,以及原有的超时分支——全绿,阶段3 收尾。

### 已完成 · 阶段4 全局软删除 retrofit(5/5)
- 非日志实体表(users/groups/clients/devices/metrics/roles/permissions/access_tokens)统一加 `deleted_at`;唯一约束改 `WHERE deleted_at IS NULL` 的 **partial unique index**(软删同名后可重建);排除 `request_logs` 与 4 张 M2M 关联表(继续硬删关联行)。迁移 `0005`。
- 软删语义**在源头集中**在 `src/common/db/soft-delete.ts` 两个助手:`alive(table, ...conds)`(= `isNull(deletedAt) AND ...`)与 `softDelete(db, table, where)`(update deleted_at=now() + returning)。所有软删表读查询 `.where()` / join ON 一律经 `alive()`,删除一律经 `softDelete()`——禁止散写 `isNull`,可 grep 审计。(Drizzle 非 active-record,不做 TypeORM 式 per-entity Repository。)
- 安全缺口一并堵:软删用户/角色的 `user_roles`/`role_permissions` 不 cascade,`getUserPermissions` 的 join ON 用 `alive(roles)`+`alive(permissions)` 排除已删授权;`JwtStrategy` 改用 `findAuthUser`(`alive(users)`)拒绝已删用户的旧 JWT。
- access token 新增 `delete`(软删)操作 + `DELETE /access-tokens/:id` 端点,与 `revoke`(改 status)**正交**:删后同步删 redis 缓存立即失效,`findByToken` 经 `alive()` 返 null → guard **401**(区别 revoke 的 403)。
- 端到端 smoke 新增软删断言:token 软删后 invoke → 401(证 alive 过滤 + 缓存删)、role 软删后同名重建拿新 id(证 partial unique)——全绿(34 断言),阶段4 收尾。
- 顺带:**全项目 prettier + eslint 归零**(此前从没跑过,155 问题 → 0;请求对象/JSON.parse/socket 自定义属性补类型,`bootstrap()` 补 `void`,`ClusterBus` handler 放宽到 `void|Promise<void>`)。

### 设计
- 三套授权域设计定稿:**后台 CASL RBAC** + **设备组一等实体(设备多组)** + **invoke 独立 access token**(按设备组作用域、可过期)。
- 全局软删除定稿:非日志实体表 `deleted_at` + partial unique + `alive()`/`softDelete()` 源头集中;`revoked`(运行状态)与 `deleted_at`(软删)正交。
  见 `docs/superpowers/specs/2026-07-08-group-scoped-rbac-invoke-tokens-design.md`,分 3 阶段落地。
