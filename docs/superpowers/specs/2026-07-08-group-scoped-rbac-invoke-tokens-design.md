# RER0RPC 三套授权域设计:后台 RBAC + 设备组一等实体 + invoke Access Token

> 状态：✅ 已实施，作为历史设计归档；当前能力与命令以 `docs/RER0RPC-核心功能统计.md` 为准。

- 日期:2026-07-08
- 状态:已确认(待用户复审 spec)
- 关联:`docs/RER0RPC-新版开工提示词.md`、`docs/design-conventions.md`

## 1. 背景与目标

现状鉴权问题:
- 只有 `users.role`(varchar,默认 `admin`)一层,无任何分组作用域。
- `POST /rpc/invoke/:group/:action` 无 `@Roles`,任意有效 JWT(含设备 token)都能调任意组。
- `group` 是松散字符串:`clients.group_name` / `devices.group_name` / `request_logs.group_name` 都是 varchar,`groups` 表(id+name)孤立,**全项目 schema 无一处 FK**。设备“属于某组”只靠字符串相等。

目标:三套**互相独立**的授权域,边界清晰。

## 2. 三套授权域

| 域 | 主体 | 认证方式 | 授权粒度 |
|---|---|---|---|
| **后台 Console** | 后台用户(admin/operator) | 用户 JWT | CASL RBAC(action, subject)+ isRoot 超管。**不按设备组细分** |
| **设备组 Device Group** | 手机设备 | 设备 JWT(clientId+secret) | 设备多组;每组 = 一个功能 |
| **invoke Access Token** | 外部调用方 | 独立 access token(Bearer) | **按设备组作用域**(一对多)+ 可过期 |

设备组是中枢实体;后台用户与 invoke token 都不直接“拥有”设备,而是:后台用户按 RBAC 权限管理系统;invoke token 按其勾选的设备组调用。

## 3. 数据模型(Drizzle / PostgreSQL)

### 3.1 后台 RBAC
```
users            + is_root boolean not null default false   (role 字段停用授权用途,保留兼容)
roles            id, name unique, description, created_at
permissions      id, action, subject, unique(action, subject)
role_permissions role_id FK→roles, permission_id FK→permissions, PK(role_id, permission_id)
user_roles       user_id FK→users, role_id FK→roles, PK(user_id, role_id)
```
> 不建 `user_groups`——后台用户不按设备组作用域(已确认)。

### 3.2 设备组(一等实体 + 多组)
```
groups           id, name unique, created_at                （升为一等实体,被 FK 引用）
clients          id, client_id unique, secret_hash, created_at   （删除 group_name）
client_groups    client_id FK→clients, group_id FK→groups, PK(client_id, group_id)   （设备多组）
devices          client_id unique, online, last_seen_at      （删除 group_name;成员关系走 client_groups）
```

### 3.3 invoke Access Token
```
access_tokens        id, name, token (明文,unique), expires_at nullable,
                     status ('active'|'disabled'|'revoked') default 'active',
                     created_by FK→users, created_at
access_token_groups  token_id FK→access_tokens, group_id FK→groups, PK(token_id, group_id)
```
> `token` **明文存库、后台可回看**(已确认)。安全权衡见 §8。

### 3.4 request_logs(取证脊柱)
- 保留 `group_name`(去规范化,不加 FK——符合“脊柱只存标量”)。
- `requester_user_id` → 新增 `access_token_id`(nullable):记录哪个 token 调的。用户发起的调用(暂无)才用 requester_user_id。

## 4. 迁移与回填

1. 新增/修改表的 DDL 由 `drizzle-kit generate` 生成。
2. **数据回填脚本**(`src/scripts/migrate-groups.ts`,一次性):
   - 对 `clients.group_name` 的每个不同值,`groups` 无则建行。
   - 为每个 client 建 `client_groups` 关联。
   - 完成后再跑删除 `clients.group_name` / `devices.group_name` 的迁移。
3. 本项目当前是开发/测试数据,允许 `docker compose down -v` 清库后重迁移 + 重种子作为兜底路径。

## 5. 守卫与装饰器

### 5.1 后台(全局)
- `APP_GUARD` 由 `[JwtAuthGuard, RolesGuard]` 改为 `[JwtAuthGuard, PermissionGuard]`(删除 RolesGuard)。
- `JwtStrategy.validate(payload)`:按 `sub` 查库,`req.user = { id, permissions: [{action,subject}], isRoot }`。
- `JwtAuthGuard`(现有 passport 版,`@Public` 跳过)保留。
- `PermissionGuard`(新):`@Public` 跳过;否则读 `@RequirePermission(action, subject)`,用 `@casl/ability` 构建 ability 判 `can(action, subject)`;**fail-closed**(挂了却没标 @RequirePermission = 拒绝);`isRoot` 绕过。
- 新装饰器 `@RequirePermission(action, subject)`;所有非 public 后台接口都要标。
- 新依赖 `@casl/ability`。

### 5.2 invoke(独立)
- `RpcController` 的 `invoke` / `clientQueue`:标 `@Public`(跳过全局 JWT/Permission)+ `@UseGuards(AccessTokenGuard)`。
- `AccessTokenGuard`(新):
  1. 取 `Authorization: Bearer <token>`,无 → 401。
  2. 查 token(**redis 缓存 60s + 未命中回落 PG**,对 redis 错误 fail-open;短负缓存钝化伪造洪水)。
  3. 未找到 → 401;`expires_at` 过期 → 401;`status != active` → 403。
  4. 解析路由 `:group`(名字)→ group_id;`group_id ∉ token 的设备组` → 403。
  5. 挂 `req.accessToken = { id, name, groups }`。

## 6. API 变更

- **设备登录**:`POST /api/client/login { clientId, secret }`(**去掉 group**)。校验 → device JWT 带该设备的 group 列表;返回 wsUrl。
- **WS 网关**:连上后按设备的**每个 group_id** 登记 presence(`group:clients:{groupId}` + `presence:{clientId}`),心跳刷新,断线从所有组清理。
- **invoke**:`:group` 名字 → group_id;鉴权走 AccessTokenGuard;调度按 group_id 选在线设备(现有轮询逻辑不变,只是 key 换成 group_id)。`request_logs` 记 access_token_id。
- **access token 管理**(后台,`@RequirePermission`):`POST /access-tokens`(勾选设备组 + 过期时间,返回明文)、`GET /access-tokens`(列表带明文)、`PATCH /access-tokens/:id/projects`(事务替换作用域并清缓存)、`POST /access-tokens/:id/revoke`。
- **RBAC 管理**(后台):角色/权限 CRUD、给用户分配角色、给角色挂权限(由 `RbacService` 实现)。
- **auth**:`GET /auth/me` 返回 `{ id, username, isRoot, permissions }`。

## 7. 种子

- admin 用户置 `is_root=true`。
- 建基础角色 `operator` + 权限集(如 `manage/device-group`、`manage/device`、`manage/access-token`、`read/monitor`、`read/metrics`)。
- 迁移回填 client_groups。

## 8. 安全说明(已接受的权衡)

`access_tokens.token` **明文存库**:库泄露即全部 invoke token 暴露。使用令牌哈希存储通常用于规避此风险。用户已明确选择明文可回看,记录在案。

## 9. 测试

- 后台:`@RequirePermission` fail-closed、isRoot 绕过、无权 403(覆盖 RBAC 与 root guard E2E)。
- 设备组:设备多组登录、WS 在多组 presence、invoke 命中任一组。
- access token:过期→401、撤销→403、组不匹配→403、命中→通;明文可回看。
- 更新 `pnpm smoke`:invoke 改用 access token 调。

## 10. 分阶段落地(= review 检查点)

1. **阶段1 设备组一等实体 + 多组**:schema(groups FK / client_groups / 删 group_name)、回填脚本、设备登录去 group、WS presence 按 group_id、invoke 名字→id、更新种子。
2. **阶段2 后台 CASL RBAC**:RBAC 表 + `@casl/ability` + RbacService + JwtStrategy 加载 + PermissionGuard 替换 RolesGuard + 全后台接口补 `@RequirePermission` + RBAC 管理 API + 种子。
3. **阶段3 invoke Access Token**:access_tokens/access_token_groups + AccessTokenService + AccessTokenGuard(带 redis 缓存)+ invoke/clientQueue 接入 + token 管理 API + request_logs requester + 更新 smoke。

每阶段:worktree 内子agent实现 → 我 review + `nest build` + 端到端验证 → 提交 + 更新 CHANGELOG。

## 11. 假设与开放项

- invoke 调用者是外部系统(持 access token),非后台用户、非设备。
- monitor 列表/详情**不**按组过滤(后台不分组)。
- access token 只按设备组作用域,不做 method/path apiRules。
- `role` varchar 字段停用但暂不删,避免牵动现有种子;后续可清理。
