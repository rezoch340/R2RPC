# 管理员账号隔离与改密实现计划

> 状态：✅ 已完成。设计见
> `docs/superpowers/specs/2026-07-24-administrator-account-isolation-design.md`。

## Goal

参考 FlowCore 增加后台账号资料修改和改密能力，并保证受保护管理员账号只能由本人修改。

## 约束

- `isRoot` 只由种子流程维护，任何 API 不得授予或修改。
- 请求者编号只读取 JWT 鉴权上下文。
- 权限守卫与账号隔离同时生效，账号隔离不能被 RBAC 权限绕过。
- 变量名使用完整语义，控制流遵循现有复杂度门禁。
- E2E 只使用 HTTP/WS 公共接口，不直连数据库、Redis、Manticore 或内部 service。

## Task 1：统一管理员写保护

- [x] 增加共享的管理员账号修改策略 service。
- [x] 不存在目标返回 404；他人修改 root 返回 403；本人 root 和普通目标放行。
- [x] 用户启停、软删除接入统一策略。
- [x] 用户角色绑定、解绑接入统一策略。
- [x] 增加策略单元测试。

## Task 2：资料与密码接口

- [x] 增加 `PATCH /users/:id`，第一版只修改 `description`。
- [x] 增加 `PATCH /users/:id/password`，密码限制为 6–128 字符。
- [x] 创建用户支持可选 `description`，输入字段补齐数据库长度上限。
- [x] 用户响应显式返回安全字段，禁止密码散列泄漏。

## Task 3：纯接口黑盒

- [x] 通过 HTTP 修改普通用户资料和密码，并验证新旧密码登录行为。
- [x] 给普通测试用户授予对应权限后，验证其不能修改 root 资料或密码。
- [x] 验证其不能停用、删除 root，也不能绑定或解绑 root 的 RBAC 角色。
- [x] 保持全部既有 HTTP/WS 场景通过。

## Task 4：文档和验证

- [x] 更新 README、后端说明、架构总览、能力矩阵、进度台账、待办、工程说明和 Changelog。
- [x] 重新生成 `docs/openapi.yaml`。
- [x] 运行 unit、build、lint、format check、黑盒边界守卫和完整 smoke。
- [x] 将设计和计划状态更新为已实施，并记录最终检查数量。

## 验证结果

- Jest：5 suites / 11 tests passed。
- Build、ESLint、命名门禁、Prettier check、OpenAPI 生成：通过。
- OpenAPI：32 个 HTTP 路径模板。
- 黑盒完整性：131 passed / 0 failed；只使用 HTTP 与真实 WebSocket。
