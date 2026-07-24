# 设计与实现记录

> 更新日期：2026-07-24。

## 目录用途

- `specs/`：已定稿并实施的行为设计。2026-07-24 的管理员隔离、权限组、系统审计、
  AppAudit、管理前端、手动 RPC 调试、统一配置、完整 Compose、容器性能验收和
  Android/JavaScript SDK 规格仍可作为
  对应领域的设计说明。
- `plans/`：已经执行完毕的实现计划，只保留任务拆分、当时命令和阶段验证结果。

计划和规格中的路径数量、测试数量及代码片段是当时阶段快照，不自动跟随之后的功能增长。
它们不是当前进度或运行命令的真源，也不得覆盖当前工程命名规范。

## 当前真源

- 当前进度：`../后端进度.md`
- 当前能力：`../RER0RPC-核心功能统计.md`
- 当前架构：`../项目总览-中文.md`
- 当前工程规则：`../design-conventions.md`
- 当前 HTTP 契约：`../openapi.yaml`

当前基线为 OpenAPI 39 个路径模板、后端 HTTP/WebSocket 黑盒 172 passed、Jest
10 suites / 35 tests、前端 Playwright 12 passed；受限 Compose 性能基线为
4 devices / 1600 requests / 0 failures / 80.03 req/s / P95 7.50 ms。

当前容器性能设计：
`specs/2026-07-24-container-performance-suite-design.md`。

当前 SDK 设计：
`specs/2026-07-24-device-sdks-design.md`。
