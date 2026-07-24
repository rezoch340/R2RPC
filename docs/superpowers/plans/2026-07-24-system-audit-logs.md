# 系统操作审计日志实现计划

> 状态：✅ 已完成。设计见
> `docs/superpowers/specs/2026-07-24-system-audit-logs-design.md`。

## Task 1：表与查询面

- [x] 新增 `system_logs` schema 和 Drizzle 迁移。
- [x] 新增只读 service/controller 和筛选 DTO。
- [x] 增加 `read/system-log` 种子权限。

## Task 2：安全采集

- [x] 增加 `@SystemAudit` 元数据装饰器。
- [x] 增加全局审计拦截器，记录成功/失败结果。
- [x] 只采集显式白名单 metadata，不复制完整 body。
- [x] 覆盖用户、project、token 和 RBAC mutation。
- [x] 覆盖登录成功/失败和全部 JWT 控制面读取。
- [x] 在全局异常过滤器补记 Guard/路由阶段拒绝并避免重复日志。
- [x] 保持 RPC invoke、设备 WS 与 AppAudit 数据面日志独立。

## Task 3：验证

- [x] 单元测试覆盖推导、人类可读摘要、登录、安全字段和失败结果。
- [x] 纯 HTTP 黑盒验证登录、读取、Guard 拒绝可读且不泄露密码。
- [x] 重新生成 OpenAPI。
- [x] 更新全部现行文档和进度台账。
- [x] 运行 build、lint、Prettier、Jest 和完整 HTTP/WS smoke。

## 验证结果

- Drizzle：15 张表、9 个迁移。
- OpenAPI：35 个 HTTP 路径模板。
- Jest：8 个 suite、24 个测试通过。
- 完整黑盒：143 passed / 0 failed，只使用 HTTP 与真实 WebSocket。
- build、`pnpm lint:check`、Prettier check、OpenAPI 生成和 E2E 边界守卫全部通过。
