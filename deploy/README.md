# RER0RPC 部署 / 本地基础设施

## 组成

| 服务 | 镜像 | 端口 | 角色 |
|---|---|---|---|
| postgres | postgres:16-alpine | 5432 | 权威业务库 + 请求日志取证脊柱 |
| redis | redis:7-alpine | 6379 | 在线状态 / 队列(BullMQ)/ 分布式锁 |
| manticore | manticoresearch/manticore | 9308(HTTP)/ 9306(MySQL) | request/response payload、AppAudit Step 原文 + 全文 |
| frontend | 本仓库 `frontend/Dockerfile` | 3001 | Next.js 管理控制台 |

端口、账号与 `backend/config.yaml` 对齐(库名/账号/密码均 `rer0rpc`)。基础设施端口可用
`POSTGRES_PORT`、`REDIS_PORT`、`MANTICORE_HTTP_PORT`、`MANTICORE_MYSQL_PORT` 覆盖，
便于和其他项目并行启动隔离环境。

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

## 管理前端

宿主机开发：

```bash
cd frontend
pnpm install
pnpm dev
```

容器运行：

```bash
docker compose -f deploy/docker-compose.yml up -d --build frontend
```

打开 `http://127.0.0.1:3001`。`deploy/frontend.yaml` 默认让浏览器连接当前主机的后端
`3000` 端口；后端位于独立域名时设置 `apiUrl`，修改文件后重启 frontend 容器即可，无需重建。
后端默认允许 CORS；生产设置 `CORS_ORIGIN` 限定控制台 Origin。

令牌与 JSON 复制优先使用 Clipboard API；通过局域网 HTTP 访问时如果浏览器不提供该 API，
公共复制组件会自动使用兼容回退。自定义开发域名或反向代理可通过
`NEXT_ALLOWED_DEV_ORIGINS` 补充 Next.js HMR 允许来源。

## 完整性冒烟

基础设施、API、Worker 都启动后：

```bash
cd backend
pnpm smoke
```

该命令执行 155 项纯 HTTP/WebSocket 黑盒检查，覆盖全部 HTTP controller 方法、系统操作审计、
权限组、管理员账号隔离与改密、两类令牌作用域二次编辑与缓存失效、Device Token 旧连接主动
断开重连、WS 协议和设备 AppAudit Step 冷路径，不直接连接数据库、Redis 或 Manticore。
可用 `BASE_URL` 指向其他运行实例：

```bash
BASE_URL=http://127.0.0.1:3000 pnpm smoke
```

提交前另跑 `pnpm lint:check`，它会检查完整变量命名以及控制流复杂度、嵌套和函数长度上限。

真实 API/Worker 就绪后运行前端浏览器黑盒：

```bash
cd frontend
E2E_API_URL=http://127.0.0.1:3000 pnpm test:e2e
```

当前 Playwright 为 10 项，通过登录 UI 获取 JWT，覆盖全部管理页、筛选分页、令牌作用域编辑、
非安全上下文复制回退、右侧日志详情、导航预取和登录保护；边界守卫禁止导入后端或直连
PostgreSQL/Redis/Manticore。

如果宿主机默认端口已被其他项目占用，请覆盖 compose 端口并用独立 `CONFIG_FILE` 对齐，
避免复用其他项目的数据实例。

## 关停 / 清库

```bash
docker compose -f deploy/docker-compose.yml down        # 停止,保留数据卷
docker compose -f deploy/docker-compose.yml down -v     # 停止并删除数据卷(清库)
```

> 生产不在 app 启动时自动迁移;迁移是独立步骤(`pnpm db:migrate`)。
