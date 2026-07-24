# RER0RPC 部署 / 本地基础设施

## 组成

| 服务 | 镜像 | 端口 | 角色 |
|---|---|---|---|
| postgres | postgres:16-alpine | 5432 | 权威业务库 + 请求日志取证脊柱 |
| redis | redis:7-alpine | 6379 | 在线状态 / 队列(BullMQ)/ 分布式锁 |
| manticore | manticoresearch/manticore | 9308(HTTP)/ 9306(MySQL) | request/response payload、AppAudit Step 原文 + 全文 |

端口、账号与 `backend/config.yaml` 对齐(库名/账号/密码均 `rer0rpc`)。

## 一键开发环境

```bash
sh deploy/dev-up.sh
```

它会:起三个容器 → 等 Postgres/Redis 就绪 → `pnpm db:migrate` → `pnpm seed:admin`。

默认管理员:`admin` / `admin123456`(可用 `ADMIN_USER` / `ADMIN_PASSWORD` 覆盖)。

## 手动步骤

```bash
docker compose -f deploy/docker-compose.yml up -d      # 起基础设施
cd backend
pnpm db:generate      # 有 schema 改动时重新生成迁移
pnpm db:migrate       # 应用迁移到 Postgres
pnpm seed:admin       # 种子管理员
pnpm dev:api          # API 进程
pnpm dev:worker       # worker 进程
```

## 完整性冒烟

基础设施、API、Worker 都启动后：

```bash
cd backend
pnpm smoke
```

该命令执行 139 项纯 HTTP/WebSocket 黑盒检查，覆盖全部 HTTP controller 方法、系统操作审计、
权限组、管理员账号隔离与改密、WS 协议和设备 AppAudit Step 冷路径，不直接连接数据库、
Redis 或 Manticore。可用 `BASE_URL` 指向其他运行实例：

```bash
BASE_URL=http://127.0.0.1:3000 pnpm smoke
```

提交前另跑 `pnpm lint:check`，它会检查完整变量命名以及控制流复杂度、嵌套和函数长度上限。

如果宿主机的 5432/6379/9308 已被其他项目占用，请改 compose 端口并用独立 `CONFIG_FILE` 对齐，避免复用其他项目的数据实例。

## 关停 / 清库

```bash
docker compose -f deploy/docker-compose.yml down        # 停止,保留数据卷
docker compose -f deploy/docker-compose.yml down -v     # 停止并删除数据卷(清库)
```

> 生产不在 app 启动时自动迁移;迁移是独立步骤(`pnpm db:migrate`)。
