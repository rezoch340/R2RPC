# 管理员账号隔离与改密设计

> 状态：✅ 已实施。
>
> 日期：2026-07-24。
>
> 参考实现：`/Users/lpitiless/Documents/FlowCore/backend/src/application/user/service.ts`、
> `controller.ts`、`entity/request.ts` 与 `backend/test/superadmin.spec.ts`。

## 1. 背景

RER0RPC 当前支持后台账号创建、查询、启停、软删除和 RBAC 角色绑定，但没有修改资料或密码的
HTTP 接口。拥有 `update/user`、`delete/user` 或 `manage/rbac` 的账号还可以修改种子管理员，
包括停用、删除和变更角色关系。

FlowCore 已采用一条简单边界：`User.isRoot` 标记的种子管理员账号只有本人能修改，其他调用方
即使具有管理权限也返回 403。RER0RPC 复用该边界，并将检查覆盖到全部直接以用户为目标的写
入口，而不是只保护改密接口。

## 2. 术语

- **受保护管理员**：`users.is_root = true` 的种子管理员。该字段只由种子流程维护，任何 HTTP
  API 均不能授予或修改。
- **请求者**：JWT 鉴权后由服务端写入 `request.user.id` 的账号；不得从请求体接收。
- **目标账号**：URL `:id` 指向、即将被修改的用户。
- `users.role` 是遗留展示字段，不参与 RBAC 授权，也不作为管理员保护判据。

## 3. 目标

1. 增加用户资料修改接口，第一版只允许修改 `description`。
2. 增加用户密码修改接口，密码散列不进入任何响应。
3. 请求者与受保护管理员不是同一账号时，所有目标用户写操作统一返回 403。
4. 受保护管理员可以修改自己的资料和密码。
5. 普通账号仍可由具有相应权限的后台账号管理，保持现有运维能力。
6. 保护启停、软删除和用户角色绑定/解绑，防止绕过资料、密码接口。
7. 黑盒验收只通过 HTTP 公共接口，不直接访问 PostgreSQL、Redis 或应用内部 service。

## 4. 非目标

- 不增加授予或撤销 `isRoot` 的 API。
- 不把遗留 `users.role` 恢复为授权依据；权限仍只由 CASL RBAC 与 `isRoot` 决定。
- 不在本次引入密码历史、强制定期轮换或 JWT `tokenVersion`。
- 修改密码后，后续密码登录立即使用新密码；已签发 JWT 仍按当前到期和账号状态规则处理。
- 不限制读取其他管理员的列表或详情；本次边界只针对写操作。

## 5. API 契约

### 5.1 修改资料

```http
PATCH /users/:id
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "description": "值班管理员"
}
```

- 权限：`update/user`；`isRoot` 仍按全局规则直通。
- `description` 最长 255 字符，空字符串可用于清空。
- 返回安全用户字段，不返回 `passwordHash`。

### 5.2 修改密码

```http
PATCH /users/:id/password
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "password": "new-password-123"
}
```

- 权限：`update/user`；`isRoot` 仍按全局规则直通。
- 密码长度 6–128 字符，与现有登录、建号最小长度兼容。
- 返回安全用户字段，不返回密码或密码散列。

## 6. 统一写保护

所有直接修改目标账号的业务方法先调用同一个
`AdministratorAccountPolicyService.assertCanMutateUser()`：

```text
查询 alive 目标用户的 id + isRoot
  ├─ 不存在：404 用户不存在
  ├─ isRoot=false：允许后续写操作
  ├─ isRoot=true 且 target.id=requester.id：允许本人写操作
  └─ isRoot=true 且 target.id!=requester.id：403 管理员账号只能由本人修改
```

覆盖入口：

| 写入口 | 权限 | 保护 |
|---|---|---|
| `PATCH /users/:id` | `update/user` | 资料 |
| `PATCH /users/:id/password` | `update/user` | 密码 |
| `POST /users/:id/enabled` | `update/user` | 启停 |
| `DELETE /users/:id` | `delete/user` | 软删除 |
| `POST /rbac/users/:userId/roles/:roleId` | `manage/rbac` | 绑定角色 |
| `DELETE /rbac/users/:userId/roles/:roleId` | `manage/rbac` | 解绑角色 |

控制器只传 JWT 身份中的请求者编号。业务 service 不能接受请求体声明的请求者身份。

## 7. 数据与响应

- 不增加数据库迁移；`description`、`password_hash` 和 `is_root` 已存在。
- 列表、详情、创建、资料更新和改密响应统一使用显式安全字段选择。
- `password_hash` 仅用于登录校验和密码更新，永不出现在用户管理 API 响应。
- `is_root` 只读返回，便于管理界面展示保护状态。

## 8. 验收标准

1. root 可以修改自己的资料和密码。
2. 具有对应权限的非 root 账号修改 root 的资料、密码、enabled、删除状态或角色关系均返回 403。
3. root 仍可修改普通账号的资料、密码、enabled、删除状态和角色关系。
4. 改密后旧密码登录返回 401，新密码登录成功。
5. 非法短密码或超长字段返回 400。
6. 用户列表、详情和所有写响应不包含 `passwordHash`。
7. Jest 覆盖本人 root、他人 root、普通目标三种策略分支。
8. 完整黑盒覆盖新增 Controller 方法与隔离边界，且边界守卫继续确认测试未直连持久层。
