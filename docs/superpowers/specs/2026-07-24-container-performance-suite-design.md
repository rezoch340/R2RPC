# 容器性能测试与 4 核 4 GiB 资源预算设计

> 日期：2026-07-24  
> 状态：已批准实施

## 1. 目标

1. 在 Docker Compose 内提供可重复的一次性性能验收，不把压测工具安装到宿主机。
2. 性能流量只能访问公开 HTTP/WebSocket，不直连 PostgreSQL、Redis、Manticore 或 Nest
   内部 service。
3. 预热、持续时间、并发、目标速率、请求超时和质量阈值全部进入统一 `config.yaml`。
4. 结果同时输出到终端和 JSON 文件；错误率、P95 延迟或最小吞吐不合格时返回非零退出码。
5. 包含常驻、一次性和性能服务的整个 Compose 声明上限不超过 4 核、4 GiB。

## 2. 性能场景

执行器先使用 `bootstrap.admin` 调用 `POST /auth/login`，通过公开后台 API 创建绑定
`performance.projectName` 的临时 Access Token 和 Device Token，再以 Device Token 挂载
`performance.virtualDeviceCount` 台在线虚拟设备。每台设备接收真实 `job`，并通过 WS 返回
包含 `message: "hello"` 与自身 `deviceClientId` 的 `result`。

正式流量在固定并发下按目标速率轮询：

| 场景 | 方法与路径 |
|---|---|
| 读取认证信息 | `GET /auth/me` |
| 读取概览指标 | `GET /metrics/overview` |
| 读取功能组 | `GET /projects` |
| 读取设备 | `GET /devices` |
| 读取请求日志 | `GET /monitor/requests?page=1&pageSize=10` |
| 读取系统日志 | `GET /system-logs?page=1&pageSize=10` |
| 读取权限组 | `GET /rbac/roles` |
| 手动 RPC 自动路由 Hello | `POST /rpc/debug/invoke/:project/hello` |
| Access Token 自动轮询 Hello | `POST /rpc/invoke/:project/hello` |
| Access Token 随机指定设备 Hello | `POST /rpc/invoke/:project/hello?clientId=<random>` |

三个 Hello 场景均设置 2 秒业务超时。自动路由不传 `clientId`，由服务端在功能组内轮询；
随机指定场景每次从在线设备池随机选择目标。除了 HTTP 成功，响应还必须满足 `is_ok=true`、
`status=ok`、`payload.message=hello`，并确认响应设备与实际目标一致。正式计量必须覆盖全部
虚拟设备。测试结束后关闭 WS，并通过公开 API 软删除两个临时令牌。

## 3. 配置契约

```yaml
performance:
  baseUrl: http://api:3000
  projectName: cn-nodes
  virtualDeviceCount: 4
  durationSeconds: 20
  warmupSeconds: 3
  concurrency: 16
  targetRequestsPerSecond: 80
  requestTimeoutMilliseconds: 5000
  maximumErrorRate: 0.01
  maximum95thPercentileLatencyMilliseconds: 750
  minimumThroughputRequestsPerSecond: 60
  resultFile: /app/performance-results/latest.json
```

- `projectName`：必须是 seed 后已存在且启用的功能组。
- `virtualDeviceCount`：挂载的在线设备数，允许 2–32，默认 4。
- `durationSeconds`：正式计量窗口，允许 5–600 秒。
- `warmupSeconds`：先执行同样流量，但不把样本计入报告。
- `concurrency`：并行 worker 数，限制单进程未完成请求量。
- `targetRequestsPerSecond`：开环目标速率；执行器按绝对时间调度，避免每个请求完成后再睡眠
  导致速率随延迟下降。
- `requestTimeoutMilliseconds`：每个公开 API 请求的独立超时。
- 三项质量阈值和全部虚拟设备覆盖必须满足；`maximumErrorRate` 使用 0–1 比例。
- `resultFile` 相对路径以配置文件目录为基准，Compose 使用容器内绝对路径。

## 4. 统计与报告

预热结束后重新开始计时和采样。报告至少包含：

- 开始时间、持续时间、目标速率和并发；
- 总请求、失败数、错误率和实际吞吐；
- 全局 P50、P95、P99；
- 每场景请求数、失败数、平均延迟、P50/P95/P99、状态码和路由设备分布；
- 各设备正式路由次数及包含预热在内的实际 job 处理次数；
- 阈值值、每项通过状态和整体通过状态。

终端输出摘要与逐场景表格，JSON 使用稳定字段并写入配置指定路径。创建目录和写报告失败也
必须使进程失败，避免 CI 误判。

## 5. Compose profile

`performance` 服务：

- 复用 `backend/Dockerfile` 生产镜像，运行 `node dist/scripts/performance.js`；
- 位于 `performance` profile，普通 `docker compose up` 不常驻该容器；
- 等待 API healthy 和 Worker started；
- 只读挂载 `/app/config.yaml`；
- 把宿主机 `performance-results/` 挂载到 `/app/performance-results`；
- `restart: "no"`，以进程退出码表达验收结果。

运行命令：

```bash
docker compose --profile performance run --rm performance
cat performance-results/latest.json
```

## 6. 资源硬限制

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

CPU 总和恰好等于 4 核，内存总和比 4 GiB 留出 256 MiB 余量。这里采用最保守的声明值相加，
即使 migration、seed、performance 正常不会同时长期运行，也不从预算中扣除。Docker daemon、
BuildKit 与宿主机进程不属于 Compose 服务预算。

## 7. 验收结果

1. 后端 lint、build 与 Jest 10 suites / 35 tests 通过。
2. `docker compose --profile performance config --quiet` 通过。
3. 渲染后的 Compose 资源合计为 4.00 CPU、3840 MiB。
4. 抽查运行容器 Docker `HostConfig`，CPU 和内存限制与 Compose 声明一致。
5. 隔离受限全栈默认参数实测：4 devices、1600 requests、0 failures、80.03 req/s、
   P50 4.88 ms、P95 7.50 ms、P99 10.31 ms。
6. 三个 Hello 场景各执行 160 次；随机指定场景覆盖 4 台设备，正式计量覆盖全部设备。
7. JSON 报告成功写入挂载目录；业务契约、设备覆盖或质量阈值失败时以非零状态退出。
