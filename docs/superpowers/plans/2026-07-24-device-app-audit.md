# 设备上报 AppAudit 日志 Step 实现计划

> 状态：✅ 已完成。设计见
> `docs/superpowers/specs/2026-07-24-device-app-audit-design.md`。

## Goal

实现设备随 WS `result` 批量上报 AppAudit V1，经请求日志冷路径保存，并由 Monitor 详情 API 返回。

## 约束

- 不改变同步 invoke 响应结构。
- 不把审计内容写入 PostgreSQL。
- E2E 只使用 HTTP/WS 公共接口，不直连数据库、Redis、Manticore或内部 service。
- 保持不传 `appAudit` 的旧设备兼容。

## Task 1：协议和校验

- [x] 增加 AppAudit V1 公共类型。
- [x] 增加 zod 校验、sequence 和 512 KiB 体积限制。
- [x] WS `ResultMessage` 与 RPC `DeviceResult` 增加可选 `appAudit`。
- [x] 非法审计只丢弃审计，不影响 RPC 结果。
- [x] 增加校验单元测试。

## Task 2：日志冷路径

- [x] `RequestLogJob` 增加 `appAudit`。
- [x] Manticore 文档增加 `app_audit_json`。
- [x] 新表建表和旧表补列均可工作。
- [x] Monitor 详情解析并返回 `appAudit`；旧日志返回 `null`。

## Task 3：纯接口黑盒

- [x] 真实 WS 设备在 `result` 顶层上报包含成功/失败 Step 的审计。
- [x] 通过 HTTP invoke 验证同步响应不暴露审计。
- [x] 只通过 `GET /monitor/requests/:requestId` 验证 Worker 保存结果。
- [x] 验证列表仍不返回审计。
- [x] 验证非法审计不影响 RPC 且日志中为 `null`。

## Task 4：文档和验证

- [x] 更新根 README、后端 README、部署说明、架构总览、能力矩阵、进度台账、待办、工程规范、继续开发提示和 Changelog。
- [x] 重新生成 `docs/openapi.yaml`。
- [x] 运行 unit、build、lint、format check、黑盒边界守卫和完整 smoke。
- [x] 将设计和计划状态更新为已实施，并记录最终检查数量。

## 验证结果

- Jest：4 suites / 8 tests passed。
- Build、ESLint、Prettier check、OpenAPI 生成：通过。
- Manticore：新表包含 `app_audit_json`；模拟旧表后 API/Worker 并发启动可自动补列。
- 黑盒完整性：121 passed / 0 failed；只使用 HTTP 与真实 WebSocket。
