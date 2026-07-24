# RER0RPC 部署与 Docker Compose

## 统一配置

API、Worker、迁移、种子和前端共用同一份 YAML schema，不再分别维护后端配置、前端 YAML
和 `.env`。

宿主机开发：

```bash
cp config.example.yaml config.yaml
```

完整 Compose：

```bash
cp deploy/config.example.yaml deploy/config.yaml
```

两份 example 的字段完全相同；宿主机模板使用 `127.0.0.1`，Compose 模板使用
`postgres`、`redis`、`manticore` 服务名。真实 `config.yaml` 已被 Git 忽略。

配置段：

- `app`：API 端口、全局前缀、公开 WebSocket 地址、CORS Origin。
- `frontend`：浏览器 API 地址/端口、开发资源允许来源。
- `db`、`redis`、`manticore`：基础设施连接。
- `jwt`：签名、有效期、授权缓存 TTL。
- `bootstrap.admin`：幂等种子管理员。
- `retention`：原始日志和聚合保留策略。

只保留可选 `CONFIG_FILE` 作为配置文件位置选择器；应用配置值不得再从环境变量读取。

## 完整 Compose 拓扑

根目录 `compose.yaml` 包含：

| 服务 | 镜像/构建 | 端口 | 角色 |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5432 | 权威业务库和请求日志脊柱 |
| `redis` | redis:7-alpine | 6379 | 在线状态、缓存、BullMQ、分布式协调 |
| `manticore` | manticoresearch/manticore | 9308/9306 | payload、AppAudit 与全文索引 |
| `migration` | `backend/Dockerfile` | — | 一次性幂等 Drizzle 迁移 |
| `seed` | `backend/Dockerfile` | — | 一次性幂等管理员、权限和演示数据种子 |
| `api` | `backend/Dockerfile` | 3000 | HTTP、Swagger、WebSocket、RPC 热路径 |
| `worker` | `backend/Dockerfile` | — | BullMQ 冷路径和定时维护 |
| `frontend` | `frontend/Dockerfile` | 3001 | Next.js 管理控制台 |

启动顺序由健康检查和完成条件保证：

```text
PostgreSQL healthy → migration completed → seed completed → API / Worker
Redis healthy ───────────────────────────────────────────→ API / Worker
Manticore healthy ───────────────────────────────────────→ API / Worker
API healthy ─────────────────────────────────────────────→ Frontend
```

应用容器以非 root 用户运行，统一配置只读挂载，持久数据进入命名卷；不固定
`container_name`，不同 Compose project 可以并行。

## 一键完整启动

```bash
cp deploy/config.example.yaml deploy/config.yaml
docker compose up -d --build
docker compose ps
```

访问：

- API：`http://127.0.0.1:3000`
- Swagger：`http://127.0.0.1:3000/docs`
- 管理前端：`http://127.0.0.1:3001`
- 默认管理员：读取 `deploy/config.yaml` 的 `bootstrap.admin`

查看一次性任务：

```bash
docker compose logs migration seed
```

重跑幂等迁移或种子：

```bash
docker compose run --rm migration
docker compose run --rm seed
```

## 宿主机开发

```bash
sh deploy/dev-up.sh
```

脚本会在缺失时从 example 生成两份本地配置，启动 PostgreSQL/Redis/Manticore，等待
PostgreSQL 与 Redis 就绪，然后在宿主机执行迁移和种子。

随后分别运行：

```bash
cd backend
pnpm dev:api
pnpm dev:worker

cd ../frontend
pnpm dev
```

前端只向浏览器注入 `frontend.apiUrl` 和 `frontend.apiPort`，不会泄露数据库、JWT 或管理员
配置。`frontend.apiUrl: null` 表示使用“当前页面协议与主机 + apiPort”。

## 验证

```bash
docker compose config --quiet
docker compose build api frontend

cd backend
pnpm lint:check
pnpm build
pnpm test
pnpm smoke

cd ../frontend
pnpm lint
pnpm build
pnpm test:e2e
```

当前基线：

- 后端 Jest：**10 suites / 35 tests**
- 后端 HTTP/WebSocket 黑盒：**172 passed**
- 前端 Playwright：**12 passed**

黑盒测试只访问公开 HTTP/WebSocket，不直连 PostgreSQL、Redis 或 Manticore。

## 关停与清理

```bash
docker compose down
docker compose down -v
```

生产环境必须更换 JWT 和管理员密码、收紧 `app.corsOrigins`、配置 TLS/WSS，并按实际入口修改
`app.publicWsUrl`。官方 PostgreSQL 镜像的首次建库账号由 Compose 引导参数创建；若修改
`deploy/config.yaml` 的数据库账号，必须同步 Compose 引导参数，或改用外部托管数据库。
