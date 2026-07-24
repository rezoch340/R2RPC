# RER0RPC 文档索引

> 更新日期：2026-07-24。当前验证基线为后端 HTTP/WebSocket 黑盒 **172 passed**、
> Jest **10 suites / 35 tests**、前端 Playwright **12 passed**、OpenAPI **39 个路径模板**；
> JavaScript SDK **10 tests**、Android SDK **8 tests**；
> 受限 Compose 性能基线为 **4 devices / 1600 requests / 0 failures / 80.03 req/s /
> P95 7.50 ms**。

## 当前有效文档

- `../README.md`：仓库入口、状态与快速开始
- `../backend/README.md`：后端配置、运行、接口行为和验证命令
- `../frontend/README.md`：管理前端页面、运行时配置、交互规则和浏览器黑盒
- `../deploy/README.md`：本地基础设施、容器和完整性验证
- `../sdk/README.md`：Android/Kotlin 与 JavaScript/TypeScript SDK 总览
- `../sdk/android/README.md`：Android SDK 安装、设备与调用方示例
- `../sdk/javascript/README.md`：JavaScript SDK 安装、设备与调用方示例
- `../CHANGELOG.md`：按交付阶段记录的变更历史
- `项目总览-中文.md`：当前架构与范围
- `RER0RPC-核心功能统计.md`：当前能力矩阵
- `后端进度.md`：唯一进度真源
- `下一步-后端待办.md`：发布就绪待办
- `design-conventions.md`：工程规范
- `device-app-audit.md`：设备上报结构化日志 Step 的当前协议
- `superpowers/specs/2026-07-24-administrator-account-isolation-design.md`：管理员账号隔离与改密设计
- `superpowers/specs/2026-07-24-permission-groups-design.md`：权限组设计
- `superpowers/specs/2026-07-24-system-audit-logs-design.md`：系统操作审计与表字段盘点
- `superpowers/specs/2026-07-24-management-frontend-design.md`：管理前端设计
- `superpowers/specs/2026-07-24-manual-rpc-debugger-design.md`：手动 RPC 调试与独立权限设计
- `superpowers/specs/2026-07-24-unified-configuration-compose-design.md`：统一配置与完整 Compose 设计
- `superpowers/specs/2026-07-24-container-performance-suite-design.md`：容器性能测试与 4 核 4 GiB 预算
- `superpowers/specs/2026-07-24-device-sdks-design.md`：Android 与 JavaScript SDK 设计
- `RER0RPC-新版开工提示词.md`：新任务交接提示
- `openapi.yaml`：HTTP OpenAPI

当前实现以运行代码、`openapi.yaml`、上述 README 和 `后端进度.md` 为准。发生 API、配置、
验证基线或用户可见行为变化时，必须在同一变更中同步这些文档。

## 历史设计

- `superpowers/specs/`：已经定稿并实施的设计
- `superpowers/plans/`：已经执行的实现计划
- `superpowers/README.md`：设计与计划的有效性边界

这些文件保留当时的决策、任务顺序和验证记录，不作为当前命令或进度真源。
其中的旧代码片段也只用于追溯，可能保留当时命名；禁止复制到活跃代码。活跃代码统一遵循 `design-conventions.md` 的完整变量名和复杂度门禁。
历史文档中的较小测试数、路径数和实施步骤表示当时阶段快照，不代表当前功能回退或待办。

## 历史归档

`archive/` 保存旧 Go/MySQL 系统总览、重写语义基线和开工阶段提示词。归档文档只用于追溯，不代表当前实现。
