# R2RPC 部署与 Docker Compose

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
`postgres`、`redis`、`manticore` 服务名。Compose 项目名固定为 `r2rpc`，确保容器网络与
命名卷不受本地仓库目录名影响。真实 `config.yaml` 已被 Git 忽略。

配置段：

- `app`：API 端口、全局前缀、公开 WebSocket 地址、CORS Origin、运行时 OpenAPI 开关。
- `frontend`：浏览器 API 地址/端口、开发资源允许来源。
- `db`、`redis`、`manticore`：基础设施连接。
- `jwt`：签名、有效期、授权缓存 TTL。
- `bootstrap.admin`：幂等种子管理员。
- `performance`：目标 API、功能组、虚拟设备数、压测时长/并发/速率、质量阈值和报告路径。
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
| `api` | `backend/Dockerfile` | 3000 | HTTP、可选 Swagger、WebSocket、RPC 热路径 |
| `worker` | `backend/Dockerfile` | — | BullMQ 冷路径和定时维护 |
| `frontend` | `frontend/Dockerfile` | 3001 | Next.js 管理控制台 |
| `performance` | `backend/Dockerfile` | — | `performance` profile 下的一次性公开 API 混合压测 |

启动顺序由健康检查和完成条件保证：

```text
PostgreSQL healthy → migration completed → seed completed → API / Worker
Redis healthy ───────────────────────────────────────────→ API / Worker
Manticore healthy ───────────────────────────────────────→ API / Worker
API TCP healthy ─────────────────────────────────────────→ Frontend
API healthy + Worker started ─────────────────────────────→ Performance
```

应用容器以非 root 用户运行，统一配置只读挂载，持久数据进入 `r2rpc` project 的命名卷；
不固定 `container_name`。

## 4 核 4 GiB 硬预算

`compose.yaml` 对每个服务同时声明 `cpus`、`mem_limit` 和 `pids_limit`。即使按最保守口径把
常驻服务、一次性 migration/seed 和可选 performance 服务全部相加，CPU 上限也恰好为
**4.00 核**，内存上限为 **3840 MiB**，不会超过 **4 GiB**。

| 服务 | CPU 上限 | 内存上限 | PID 上限 |
|---|---:|---:|---:|
| `postgres` | 0.65 | 640 MiB | 128 |
| `redis` | 0.25 | 256 MiB | 64 |
| `manticore` | 0.65 | 640 MiB | 128 |
| `migration` | 0.15 | 192 MiB | 64 |
| `seed` | 0.15 | 192 MiB | 64 |
| `api` | 0.85 | 704 MiB | 256 |
| `worker` | 0.40 | 384 MiB | 192 |
| `frontend` | 0.30 | 320 MiB | 128 |
| `performance` | 0.60 | 512 MiB | 128 |
| **声明上限合计** | **4.00** | **3840 MiB** | — |

该预算约束 Compose 创建的运行容器；Docker BuildKit、Docker daemon 与宿主机本身不属于
Compose 服务资源统计。migration、seed 和 performance 是一次性容器，正常运行时不会长期
同时占用预算，但仍已计入上述最坏情况合计。

## 一键完整启动

```bash
cp deploy/config.example.yaml deploy/config.yaml
docker compose up -d --build
docker compose ps
```

访问：

- API：`http://127.0.0.1:3000`
- Swagger：`http://127.0.0.1:3000/docs`（仅 `app.openApiEnabled: true`）
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

## 生产配置与关闭 OpenAPI

运行时 Swagger 默认开启，便于本地开发和黑盒验收。生产部署建议在
`deploy/config.yaml` 中关闭：

```yaml
app:
  port: 3000
  globalPrefix: ''
  publicWsUrl: wss://rpc.example.com/api/client/ws
  openApiEnabled: false
  corsOrigins:
    - https://console.example.com
```

修改统一配置后重启 API：

```bash
docker compose up -d --force-recreate api
```

`openApiEnabled: false` 只是不注册运行时 `/docs` 和 Swagger JSON 路由，不影响业务 HTTP、
设备 WebSocket、管理前端，也不影响仓库中的 `docs/openapi.yaml` 或
`pnpm openapi:gen`。配置关闭后 `/docs` 返回 `404`。

Compose 的 API 健康检查使用容器内 TCP 连接，不依赖 `/docs`，因此关闭运行时 OpenAPI 不会
导致 API、Frontend 或其他依赖服务被误判为不健康。

## 容器内性能测试

先按“一键完整启动”运行常驻服务，再执行：

```bash
docker compose --profile performance run --rm performance
cat performance-results/latest.json
```

performance 服务使用 `deploy/config.yaml` 的 `performance` 段，以 `bootstrap.admin`
登录后通过公开 API 创建临时令牌，并向 `http://api:3000/api/client/ws` 挂载 4 台虚拟设备。
10 个混合场景包含控制面读取、手动自动路由 Hello、Access Token 自动轮询 Hello 和随机指定
设备 Hello，不允许直连数据库、Redis、Manticore 或 Nest 内部 service。默认执行 3 秒预热和
20 秒计量，以 16 并发维持 80 req/s；错误率、P95、吞吐或设备覆盖不合格时容器退出失败。

结果写入宿主机 `performance-results/latest.json`，目录由 Git 忽略。调整参数时复制并修改
`deploy/config.yaml`，无需增加环境变量。

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
docker compose --profile performance run --rm performance

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
- 后端 HTTP/WebSocket 黑盒：**180 passed**
- 前端 Playwright：**12 passed**
- 受限 Compose 性能测试：**4 devices / 1600 requests / 0 failures / 80.03 req/s / P95 7.50 ms**

黑盒与性能测试只访问公开 HTTP/WebSocket，不直连 PostgreSQL、Redis 或 Manticore。受限
性能基线中 3 个 Hello 场景各执行 160 次，4 台设备全部收到任务；实际容器资源限制已通过
Docker `HostConfig` 核验。

## 关停与清理

```bash
docker compose down
docker compose down -v
```

生产环境必须设置 `app.openApiEnabled: false`、更换 JWT 和管理员密码、收紧
`app.corsOrigins`、配置 TLS/WSS，并按实际入口修改 `app.publicWsUrl`。官方 PostgreSQL
镜像的首次建库账号由 Compose 引导参数创建；若修改 `deploy/config.yaml` 的数据库账号，
必须同步 Compose 引导参数，或改用外部托管数据库。

## 本地质量门禁与 GHCR

- `./scripts/local-ci.sh` 在本地执行后端与前端 lint、格式、构建、单测、OpenAPI/Drizzle
  漂移和 Compose 配置校验。
- `./scripts/local-ci.sh --full` 额外使用独立 Compose 项目执行后端 HTTP/WebSocket 黑盒和
  前端 Playwright 黑盒，测试固定读取 `deploy/config.example.yaml`；Pull Request 与 `main`
  推送不运行云端质量门禁。
- `.github/workflows/publish-ghcr.yml` 在推送合法 `v*` 标签时发布：
  - `ghcr.io/rezoch340/r2rpc-backend:<tag>` 与 `latest`
  - `ghcr.io/rezoch340/r2rpc-frontend:<tag>` 与 `latest`
- backend 镜像同时承载 API、Worker、migration、seed 和 performance 入口；部署时通过命令
  区分职责，不重复发布 Worker 镜像。
- 发布矩阵不构建或发布 Android/JavaScript SDK；每个服务镜像必须小于等于 500 MiB。
