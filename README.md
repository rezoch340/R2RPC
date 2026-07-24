# RER0RPC

设备侧 RPC 中继后端。调用方通过 HTTP 把任务派发给在线 WebSocket 设备，设备执行后实时回传结果。

## 状态

- 后端 backlog #1–#14：全部完成
- 34 个 HTTP 路径模板 + `/api/client/ws`
- NestJS API / Worker 双进程
- PostgreSQL + Redis/BullMQ + Manticore
- 设备可随 WS `result` 上报 AppAudit V1 结构化日志 Step
- 后台账号支持资料修改与改密；`isRoot` 管理员账号只能由本人修改
- Role 已升级为 FlowCore 风格权限组；RBAC 写操作仅种子管理员可执行
- 136 项纯 HTTP/WS 黑盒冒烟
- 管理前端与设备 SDK：不在本仓库范围

## 快速开始

```bash
# 1. 基础设施、迁移和种子
sh deploy/dev-up.sh

# 2. 两个终端分别启动
cd backend
pnpm dev:api
pnpm dev:worker
```

默认：

- API：`http://127.0.0.1:3000`
- Swagger：`http://127.0.0.1:3000/docs`
- 管理员：`admin / admin123456`

## 验证

```bash
cd backend
pnpm lint:check
pnpm test
pnpm smoke
```

`pnpm lint:check` 强制可读变量名和控制流复杂度上限。`pnpm smoke` 与 `pnpm test:e2e` 是黑盒完整性测试，只通过运行中的 HTTP/WebSocket 接口验证系统，不直接连接数据库或 Redis。

## 目录

```text
backend/   NestJS API、Worker、迁移和测试
deploy/    本地 PostgreSQL/Redis/Manticore 编排
docs/      当前文档、OpenAPI、历史设计与归档
```

## 文档

- [项目总览](docs/项目总览-中文.md)
- [当前核心能力矩阵](docs/RER0RPC-核心功能统计.md)
- [后端进度台账](docs/后端进度.md)
- [后端开发说明](backend/README.md)
- [部署与本地基础设施](deploy/README.md)
- [工程规范](docs/design-conventions.md)
- [设备 AppAudit V1 接入协议](docs/device-app-audit.md)
- [管理员账号隔离与改密设计](docs/superpowers/specs/2026-07-24-administrator-account-isolation-design.md)
- [权限组设计](docs/superpowers/specs/2026-07-24-permission-groups-design.md)
- [OpenAPI](docs/openapi.yaml)
- [Changelog](CHANGELOG.md)
