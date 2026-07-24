# 权限组实现计划

> 状态：✅ 已完成。设计见
> `docs/superpowers/specs/2026-07-24-permission-groups-design.md`。

## Goal

将 RER0RPC 已有 Role/RBAC 提升为 FlowCore 风格的权限组管理契约，并用种子管理员身份隔离全部
RBAC 写操作。

## 约束

- 复用现有四张 RBAC 表，不增加迁移。
- 新增入口不删除旧 API。
- 权限组查询不得出现 N+1。
- 所有变量名使用完整语义，控制流通过现有门禁。
- E2E 只走 HTTP/WS，不直连持久层。

## Task 1：身份闸与 DTO

- [x] 增加无依赖 `RootGuard` 及单元测试。
- [x] RBAC 全部写端点叠加 RootGuard。
- [x] 增加更新权限组、请求体挂权限、请求体分配组 DTO。
- [x] 创建角色和权限 DTO 补齐数据库长度上限。

## Task 2：权限组读取与编辑

- [x] `GET /rbac/roles` 批量返回嵌套 permissions。
- [x] `PATCH /rbac/roles/:id` 支持 name/description。
- [x] 同名返回 409，不存在返回 404，空更新返回 400。
- [x] `GET /rbac/users/:userId/roles` 返回用户有效权限组。

## Task 3：兼容入口与种子

- [x] 增加 `POST /rbac/roles/:roleId/permissions` 请求体入口。
- [x] 增加 `POST /rbac/users/:userId/roles` 请求体入口。
- [x] 保留并验证旧 URL 形式 POST。
- [x] 种子目录增加 `read/rbac`，operator 自动获得只读权限。

## Task 4：纯接口黑盒

- [x] 验证权限组编辑和嵌套权限。
- [x] 验证用户权限组查询。
- [x] 验证具有 `read/rbac` 的普通用户可读。
- [x] 验证具有 `manage/rbac` 的普通用户仍不能写。
- [x] 保持 RBAC 实时授权/撤销和所有既有 HTTP/WS 场景通过。

## Task 5：文档与验证

- [x] 更新全部当前文档和进度台账。
- [x] 重新生成 OpenAPI。
- [x] 运行 unit、build、lint、format check 和完整黑盒 smoke。
- [x] 记录最终 API 路径数、测试数和冒烟断言数。

## 验证结果

- OpenAPI：34 个 HTTP 路径模板。
- Jest：6 个 suite、14 个测试通过。
- 完整黑盒：136 passed / 0 failed，只使用 HTTP 与真实 WebSocket。
- build、`pnpm lint:check`、Prettier check、OpenAPI 生成和 E2E 边界守卫全部通过。
