# 权限组设计

> 状态：✅ 已实施并验证。
>
> 日期：2026-07-24。

## 1. 背景

RER0RPC 已有 `roles`、`permissions`、`role_permissions` 和 `user_roles`，权限计算也已经通过
CASL 生效。但当前管理 API 更接近底层关联表操作，还缺少面向管理界面的“权限组”契约：

- 角色列表不返回组内权限。
- 角色名称和描述不能编辑。
- 不能查询某个用户已分配的权限组。
- RBAC 写操作只要求 `manage/rbac`，该权限可以继续委派，缺少种子管理员身份闸。
- 角色/用户绑定的 POST 只能把关联编号放在 URL 中，不方便表单式客户端复用。

本次不新建另一套“用户组”表。`Role` 继续作为权限组，已有四张表就是权威数据模型。

## 2. 术语与边界

- **权限组**：`roles` 行；名称、描述和一组权限的集合。
- **权限**：`permissions` 的 `(action, subject)`，内置权限同时提供可直接展示的完整说明。
- **用户分组**：`user_roles` 将多个权限组分配给一个用户；用户权限是所有有效组权限的并集。
- **种子管理员**：`users.is_root=true`。只有该身份可以修改权限组、权限目录和用户分组。
- **可查看者**：具有 `read/rbac` 的普通用户可以读取权限组、权限目录和用户已分配组。

`users.role` 仍是遗留展示字段，与权限组无关，不参与授权。

## 3. 目标

1. `GET /rbac/roles` 返回权限组及其完整权限数组。
2. 增加 `PATCH /rbac/roles/:id`，可修改组名和描述。
3. 增加 `GET /rbac/users/:userId/roles`，返回用户当前有效权限组。
4. 增加请求体形式的权限挂载和用户分组接口，同时保留旧 URL 形式兼容。
5. RBAC 全部写操作叠加 `RootGuard`；仅持有 `manage/rbac` 不能绕过。
6. RBAC 三个读入口使用 `read/rbac`，并将该权限加入种子目录和 operator 只读组。
7. 查询使用固定次数的批量 SQL，不按角色逐条查权限。
8. 黑盒验收只通过 HTTP，不直接访问数据库或应用内部 service。

## 4. 非目标

- 不改四张 RBAC 表，不新增数据库迁移。
- 不改变 CASL 的“多组权限取并集”算法。
- 不删除现有 `/rbac/roles/:roleId/permissions/:permissionId` 和
  `/rbac/users/:userId/roles/:roleId` POST 兼容入口。
- 不把用户创建、资料、密码、enabled 或删除改成 root 专属；这些继续沿用现有细粒度权限和
  管理员账号隔离策略。
- 不在后端硬编码前端中文权限标签；API 返回 action、subject 和 description。

## 5. API 契约

### 5.1 权限组列表

```http
GET /rbac/roles
```

需要 `read/rbac`。响应：

```json
[
  {
    "id": 2,
    "name": "operator",
    "description": "只读权限组",
    "createdAt": "2026-07-24T12:00:00.000Z",
    "permissions": [
      {
        "id": 1,
        "action": "read",
        "subject": "user",
        "description": "查看后台账号"
      }
    ]
  }
]
```

无权限的组返回 `permissions: []`。

### 5.2 编辑权限组

```http
PATCH /rbac/roles/:id

{
  "name": "auditor",
  "description": "审计只读"
}
```

- `name`、`description` 至少提供一个。
- 名称最长 64 字符，描述最长 255 字符。
- 仅 root；同名冲突返回 409，不存在返回 404。
- 返回包含 `permissions` 的完整权限组。

### 5.3 权限挂载

新增表单式入口：

```http
POST /rbac/roles/:roleId/permissions

{
  "permissionId": 12
}
```

保留兼容入口：

```http
POST /rbac/roles/:roleId/permissions/:permissionId
```

两者调用同一 service，均仅 root。

### 5.4 用户权限组

查询：

```http
GET /rbac/users/:userId/roles
```

需要 `read/rbac`，返回与权限组列表相同的组结构。

新增表单式分配入口：

```http
POST /rbac/users/:userId/roles

{
  "roleId": 2
}
```

保留原有 URL 形式 POST 和 DELETE。所有分配/移除操作仅 root，并继续执行
`AdministratorAccountPolicyService`，因此 root 也不能修改其他受保护管理员的组关系。

## 6. RootGuard

`RootGuard` 只读取全局 JWT 守卫已经写入的 `request.user.isRoot`：

```text
isRoot=true  -> 放行
isRoot=false -> 403 仅种子管理员可执行此操作
无 user      -> 403
```

RBAC 写接口同时保留 `@RequirePermission('manage', 'rbac')` 作为 fail-closed 声明，但 root 会由
现有 `PermissionGuard` 身份直通。普通用户即使通过权限组获得 `manage/rbac`，仍会被 RootGuard
拒绝。

## 7. 查询与软删除

- 权限组主记录和权限关联分两次批量查询，再在内存中按 `roleId` 组装。
- 查询次数不随权限组数量增长，禁止 N+1。
- 角色和权限均使用 `alive()`；软删记录及指向软删记录的历史关联不可见。
- 输出按角色编号、权限编号排序，保证稳定。

## 8. 兼容策略

- 数据库 schema 不变，部署只需重跑 `pnpm seed:admin` 增加 `read/rbac`。
- 种子会幂等更新全部内置权限 `description`，已有环境无需手工修改权限说明。
- `manage/rbac` 保留给旧数据兼容，但不再足以执行写操作。
- CASL 的 `manage` 动作仍可覆盖 `read/rbac`，所以已有管理角色的读取不会中断。
- 旧 POST URL 继续工作，新客户端优先使用请求体形式。

## 9. 验收标准

1. root 能创建、编辑、删除权限组并配置权限。
2. 权限组列表和用户权限组列表返回嵌套权限，空组返回空数组。
3. 新旧两种 POST 绑定形式都能工作。
4. 具有 `read/rbac` 的非 root 可以读取权限组、权限和用户已分配组。
5. 具有 `manage/rbac` 的非 root 仍不能创建、编辑、删除或绑定任何 RBAC 数据。
6. 用户组分配后，现有 JWT 在下一次请求立即获得该组权限；移除后立即失去。
7. Jest 覆盖 RootGuard 的 root、非 root 和缺失身份分支。
8. 完整黑盒继续覆盖全部 HTTP/WS 场景，且不直连持久层。

## 10. 实施结果

- 未新增数据库迁移；现有四张 RBAC 表完整复用。
- OpenAPI 导出 34 个 HTTP 路径模板。
- Jest 6 个 suite、14 个测试全部通过，其中 RootGuard 新增 3 个身份分支测试。
- 完整隔离环境中 API + Worker 黑盒为 `136 passed, 0 failed`。
- `test/assert-blackbox-e2e.js` 确认 E2E 只访问 HTTP/WebSocket。
- build、`pnpm lint:check` 与 Prettier check 全部通过。
- 后续手动 RPC 调试增加 `invoke/manual-rpc` 后，当前内置权限为 19 条且说明全部非空；完整
  权限目录见 `../../../backend/README.md`。
