# RER0RPC

设备侧 RPC 中继平台。调用方通过 HTTP 把任务派发给在线 WebSocket 设备，设备执行后实时回传结果；后台通过独立管理控制台管理功能组、设备、令牌、账号和日志。

## 状态

- 后端 backlog #1–#15：全部完成
- 37 个 HTTP 路径模板 + `/api/client/ws`
- NestJS API / Worker 双进程
- PostgreSQL + Redis/BullMQ + Manticore
- 设备可随 WS `result` 上报 AppAudit V1 结构化日志 Step
- 后台账号支持资料修改与改密；`isRoot` 管理员账号只能由本人修改
- Role 已升级为权限组管理模型；RBAC 写操作仅种子管理员可执行
- 系统操作审计覆盖登录成功/失败、控制面读取、Guard 拒绝和业务写操作，且不记录密码/token 明文
- Next.js 16 + shadcn 管理前端覆盖全部后台管理能力
- 全部实体表支持字段筛选与分页，默认 10 条/页、最大 100 条/页
- 运行概览使用近 7 天折线趋势图；请求详情使用宽版右侧抽屉，AppAudit Step 默认收起
- Access Token 与 Device Token 均可二次编辑功能组；鉴权缓存立即失效，Device Token 的旧作用域连接会主动断开并按新作用域重连
- 令牌和 JSON 载荷统一使用公共复制组件，局域网 HTTP 下会自动回退到兼容复制
- 155 项纯 HTTP/WS 黑盒冒烟
- 前端 Playwright 10 项浏览器 E2E，只通过 UI 与公开 HTTP API，不直连持久层
- 设备 SDK：不在本仓库范围

## 快速开始

```bash
# 1. 基础设施、迁移和种子
sh deploy/dev-up.sh

# 2. 两个终端分别启动
cd backend
pnpm dev:api
pnpm dev:worker

# 3. 第三个终端启动管理前端
cd ../frontend
pnpm install
pnpm dev
```

默认：

- API：`http://127.0.0.1:3000`
- Swagger：`http://127.0.0.1:3000/docs`
- 管理前端：`http://127.0.0.1:3001`
- 管理员：`admin / admin123456`

## 验证

```bash
cd backend
pnpm lint:check
pnpm test
pnpm smoke

cd ../frontend
pnpm lint
pnpm build
E2E_API_URL=http://127.0.0.1:3000 pnpm test:e2e
```

`pnpm lint:check` 强制可读变量名和控制流复杂度上限。`pnpm smoke` 与 `pnpm test:e2e` 是黑盒完整性测试，只通过运行中的 HTTP/WebSocket 接口验证系统，不直接连接数据库或 Redis。

## 目录

```text
backend/   NestJS API、Worker、迁移和测试
frontend/  Next.js + shadcn 管理控制台与浏览器黑盒
deploy/    本地 PostgreSQL/Redis/Manticore 编排
docs/      当前文档、OpenAPI、历史设计与归档
```

## 文档

- [项目总览](docs/项目总览-中文.md)
- [文档索引与有效性说明](docs/README.md)
- [当前核心能力矩阵](docs/RER0RPC-核心功能统计.md)
- [后端进度台账](docs/后端进度.md)
- [后端开发说明](backend/README.md)
- [前端开发说明](frontend/README.md)
- [部署与本地基础设施](deploy/README.md)
- [工程规范](docs/design-conventions.md)
- [设备 AppAudit V1 接入协议](docs/device-app-audit.md)
- [管理员账号隔离与改密设计](docs/superpowers/specs/2026-07-24-administrator-account-isolation-design.md)
- [权限组设计](docs/superpowers/specs/2026-07-24-permission-groups-design.md)
- [系统操作审计日志设计](docs/superpowers/specs/2026-07-24-system-audit-logs-design.md)
- [管理前端设计](docs/superpowers/specs/2026-07-24-management-frontend-design.md)
- [OpenAPI](docs/openapi.yaml)
- [Changelog](CHANGELOG.md)
