# R2RPC Backend

NestJS 11 后端，采用 API/Worker 双进程：

- API：HTTP、Swagger、设备 WebSocket、RPC 热路径
- Worker：BullMQ 日志消费、Manticore payload/AppAudit、日指标、定时维护

## 依赖

- Node.js 24+
- pnpm
- PostgreSQL 16
- Redis 7
- Manticore Search

基础设施可从仓库根目录启动：

```bash
sh deploy/dev-up.sh
```

## 配置

API、Worker、迁移、种子和前端共用根目录统一配置。后端从当前目录向上查找最近的
`config.yaml`，也可用 `CONFIG_FILE` 选择其他同 schema 文件。

```bash
cd ..
cp config.example.yaml config.yaml
```

配置包含：

- `app.port`、`app.globalPrefix`、`app.publicWsUrl`、`app.corsOrigins`
- `frontend.apiUrl`、`frontend.apiPort`、`frontend.allowedDevOrigins`
- PostgreSQL
- Redis
- JWT（含 `authorizationCacheTtlSeconds`，用户授权缓存默认 60 秒，允许 60–300 秒）
- Manticore
- `bootstrap.admin` 种子管理员
- `performance` 固定速率压测参数、质量阈值和报告路径
- 原始日志和日聚合保留策略

配置由 zod 校验，非法值会让进程启动失败。
`CONFIG_FILE` 只选择文件位置；CORS、管理员和其他业务配置值不再读取环境变量。

## 初始化

```bash
pnpm install
pnpm db:migrate
pnpm seed:admin
```

迁移是独立部署步骤，API/Worker 启动时不会自动修改数据库。

## 运行

```bash
pnpm dev:api       # HTTP + WS，默认端口 3000
pnpm dev:worker    # BullMQ + 维护任务
```

生产编译和入口：

```bash
pnpm build
node dist/main.js
node dist/worker.js
```

Swagger 位于 `/docs`，设备 WebSocket 位于 `/api/client/ws`。

生产镜像与完整 Compose：

```bash
docker build -t r2rpc-backend backend
cp deploy/config.example.yaml deploy/config.yaml
docker compose up -d --build
```

同一后端镜像通过不同命令运行 migration、seed、API 和 Worker，具体依赖顺序见
`../compose.yaml` 与 `../deploy/README.md`。

## 后台账号写保护

- `PATCH /users/:id` 修改 `description`。
- `PATCH /users/:id/password` 修改密码，长度限制为 6–128 字符。
- `users.isRoot=true` 的种子管理员账号只能由本人修改。
- 资料、密码、启停、软删除、RBAC 角色绑定和解绑均执行同一服务层保护。
- 请求者编号只从 JWT 鉴权上下文读取；用户响应显式排除 `passwordHash`。
- `users.role` 仍是遗留展示字段，不参与 RBAC 授权或管理员保护。

完整设计见
`../docs/superpowers/specs/2026-07-24-administrator-account-isolation-design.md`。

## 权限组

- 现有 `roles` 就是权限组，不另建用户组表；一个用户可分配多个权限组，最终权限取并集。
- `GET /rbac/roles` 和 `GET /rbac/users/:userId/roles` 返回组内嵌套权限。
- `PATCH /rbac/roles/:id` 可修改权限组名称和描述。
- 权限挂载和用户分组同时支持请求体形式与原 URL 形式，旧客户端无需迁移。
- RBAC 读接口要求 `read/rbac`；所有 RBAC 写接口再叠加 `RootGuard`，仅种子管理员可执行，
  普通用户即使拥有 `manage/rbac` 也不能修改权限组、权限目录或用户分组。
- 每条内置权限都必须提供面向管理员的完整 `description`；种子脚本会幂等补齐现有权限说明。
- 没有 schema 变化；部署后重跑 `pnpm seed:admin` 即可补齐权限及说明。
- JWT 用户身份与权限快照通过 `RedisCacheAsideService.getOrLoad` 读取：Redis 未命中、数据不符合
  zod 契约或 Redis 故障时回源 PostgreSQL，查询成功后回写 Redis。
- 权限组挂载/移除权限、权限或权限组删除、用户分组/移组、账号启停和软删除均通过公共
  `writeAndInvalidate` 在数据库写入成功后删除相关用户缓存；默认 TTL 为 60 秒。

### 内置权限目录

| 权限 | 说明 |
|---|---|
| `read/user` | 查看后台账号 |
| `create/user` | 创建后台账号 |
| `delete/user` | 删除后台账号 |
| `update/user` | 修改后台账号资料、密码和启用状态 |
| `read/project` | 查看功能组 |
| `create/project` | 创建功能组 |
| `delete/project` | 删除功能组 |
| `update/project` | 修改功能组启用状态 |
| `read/metrics` | 查看运行指标和趋势 |
| `read/monitor` | 查看 RPC 请求日志 |
| `read/system-log` | 查看系统操作审计日志 |
| `invoke/rpc` | 保留的 RPC 调用权限；公开调用仍使用 Access Token |
| `read/rpc` | 查看 RPC 运行信息 |
| `read/rbac` | 查看权限组和权限目录 |
| `manage/rbac` | 管理权限组、权限目录和用户分组 |
| `manage/access-token` | 管理调用方 Access Token |
| `manage/device-token` | 管理设备 Device Token |
| `read/device` | 查看设备及在线状态 |
| `invoke/manual-rpc` | 在管理控制台手动发起 RPC 调试调用 |

完整设计见 `../docs/superpowers/specs/2026-07-24-permission-groups-design.md`。

## 手动 RPC 调试

- `GET /rpc/debug/options?project=<name>` 返回可选功能组、所选功能组的历史 Action 和当前在线
  `clientId`，要求后台 JWT 具有 `invoke/manual-rpc`。
- `POST /rpc/debug/invoke/:project/:action?clientId=<optional>` 接收现有
  `{ timeoutSeconds?, payload }` 契约，通过真实 RPC 派发链路调用设备；不需要也不接受
  Access Token。
- 未指定 `clientId` 时仍由服务端在功能组内轮询；指定时只调用该在线设备。
- 手动调用继续写 `request_logs`，并把 JWT 用户编号写入 `requesterUserId`；公开
  `/rpc/invoke/*` 则继续记录 `accessTokenId`。
- 调试调用写系统操作审计，记录功能组、Action、目标设备和超时，但不记录 Payload。
- 公开 `POST /rpc/invoke/:project/:action` 及 `GET /rpc/clientQueue` 的 Access Token
  边界保持不变。

完整设计见 `../docs/superpowers/specs/2026-07-24-manual-rpc-debugger-design.md`。

## 令牌作用域与过期策略

- Device Token 是设备长期凭证，不接受过期时间；其生命周期只由撤销或软删除控制。Access
  Token 支持可选绝对过期时间与最大 RPC 调用次数。
- `PATCH /access-tokens/:id` 可在同一次事务中替换完整 `projects` 集合，并编辑
  `expiresAt`、`maximumUsageCount`；字段设为 `null` 表示取消对应限制，编辑不会重置
  `usageCount`。
- `PATCH /access-tokens/:id/projects` 与 `PATCH /device-tokens/:id/projects` 使用完整
  `projects` 名称集合替换现有作用域；Access Token 的旧路径保留为兼容入口。空数组和不存在的
  project 会被拒绝，重复名称会去重。
- 只有通过鉴权和请求参数校验的公开 `POST /rpc/invoke/:project/:action` 消耗一次额度；
  `GET /rpc/clientQueue` 不消耗。调用到达业务层后，无设备、设备错误或超时均计数。
- 有次数上限的调用通过 PostgreSQL 条件更新原子计数，达到上限返回 `429`；不限次数令牌不写
  计数并继续使用 Redis cache-aside 热路径。
- Access Token 更新后立即删除 Guard 正缓存，新增与移除的作用域从下一次 RPC 请求开始生效。
- Device Token 更新后删除 WS 鉴权缓存，并发布
  `ws:device-token-scope-changed` 集群事件；所有 API 实例会以 close `4002` 断开该 token 的
  现有连接，设备重连后继承新作用域。
- 两类更新均写入系统操作审计；metadata 只记录编号、project 集合和 Access Token 过期策略，
  不记录 token 明文。

## 系统操作审计

- `system_logs` 是不可变追加表，包含 `name`、`description`、操作者、动作、对象、结果、IP 和时间。
- `GET /system-logs` 使用 `read/system-log`，支持事件名称、操作者、action、subject、目标类型、
  目标名称、状态、时间和分页筛选。
- 登录成功/失败、JWT 控制面读取、Guard/路由阶段拒绝和后台 mutation 全部记录；mutation
  继续显式声明 `@SystemAudit` 以提供准确业务名称和对象。
- metadata 只读取声明的安全 path/body/query 字段，不复制完整请求体，密码与 token 明文不会入库。
- RPC invoke、设备 WebSocket 与 AppAudit 使用各自日志链路，不重复写入高频系统访问日志。
- 系统日志没有修改或删除 API，也不与 RPC `request_logs`、设备 AppAudit 混用。

完整设计见 `../docs/superpowers/specs/2026-07-24-system-audit-logs-design.md`。

## 性能测试

性能执行器以 `bootstrap.admin` 登录，通过公开 API 创建临时 Access Token/Device Token，
再以 `performance.virtualDeviceCount` 挂载虚拟 WebSocket 设备。混合场景覆盖控制面读取、
手动 RPC 自动路由、Access Token 自动轮询 Hello 和随机指定在线设备 Hello。每个设备返回
真实 WS `result`；执行器不导入应用模块，也不访问 PostgreSQL、Redis 或 Manticore。

API 与 Worker 已运行时，可在宿主机执行：

```bash
pnpm performance
```

完整容器验收从仓库根目录执行：

```bash
docker compose --profile performance run --rm performance
cat performance-results/latest.json
```

`performance` 配置控制功能组、虚拟设备数、预热时间、持续时间、并发数、目标请求速率、
单请求超时、最大错误率、P95 延迟上限、最小吞吐和 JSON 报告路径。预热数据不计入报告；
任一质量阈值不满足或正式计量未覆盖全部虚拟设备时进程以非零状态退出。默认挂载 4 台设备，
执行 3 秒预热、20 秒测量、16 并发和 80 req/s；结束后关闭连接并删除临时令牌。

完整契约与资源预算见
`../docs/superpowers/specs/2026-07-24-container-performance-suite-design.md`。

## 测试

### 单元测试

```bash
pnpm test
```

当前为 Jest **10 suites / 35 tests**，覆盖统一配置文件查找/显式选择/schema 默认值/非法配置，
以及公共 Redis cache-aside 的命中、PostgreSQL fallback 回写、负缓存、脏数据失效、写后删除
和写失败不删缓存。

### 黑盒 E2E / 完整性冒烟

先启动基础设施、API 和 Worker：

```bash
pnpm smoke
# 等价：
pnpm test:e2e
```

可指定目标：

```bash
BASE_URL=http://127.0.0.1:3000 pnpm smoke
```

黑盒套件：

- 只使用 `fetch` 和 WebSocket 客户端访问公开接口
- 覆盖所有 HTTP controller 方法
- 覆盖 WS 鉴权、welcome、heartbeat、ping、读超时、分片和超大帧
- 覆盖 RPC 成功、失败、超时、身份匹配、去重和 maxInFlight
- 覆盖设备通过真实 WS 上报 AppAudit 成功/失败 Step、非法审计隔离和 Monitor API 读取
- 覆盖用户资料、改密和管理员资料/密码/启停/删除/RBAC 角色关系隔离
- 覆盖权限组编辑、嵌套权限、用户分组查询和非 root 持 `manage/rbac` 仍被拒绝
- 覆盖授权缓存已命中后的权限挂载、移除、权限删除、用户分组、启停和软删除即时生效
- 覆盖两类令牌二次编辑功能组、Access Token 时间/次数策略、并发原子计数、额度用尽 `429`、
  缓存即时失效和 Device Token 旧作用域连接断开重连
- 覆盖全部 19 条内置权限说明、`invoke/manual-rpc` 拒绝/放行、真实设备往返、系统审计和
  `requesterUserId` 溯源
- 覆盖登录成功/失败、控制面读取、Guard 拒绝、业务写入、筛选和密码不泄露
- 通过 monitor/metrics API 观察 Worker 冷路径
- 当前为 180 项运行时检查

`test/assert-blackbox-e2e.js` 会拒绝 E2E 或性能执行器导入持久层客户端或应用内部服务。

### 内部集成检查

下列命令直接构造 PG/Redis 状态，属于算法集成检查，明确不是 E2E：

```bash
pnpm test:integration:retention
pnpm test:integration:device-stale
pnpm test:integration:metrics
pnpm test:integration:max-inflight
```

## 质量检查

```bash
pnpm build
pnpm lint:check    # 只检查，不改文件
pnpm lint          # 检查并执行 ESLint 可自动修复项
pnpm format
```

命名门禁覆盖 `src/` 和 `test/`：拒绝单/双字母变量及团队禁止缩写。ESLint 同时强制圈复杂度 ≤ 10、嵌套深度 ≤ 3、单函数语句数 ≤ 40、条件分支使用花括号并移除多余 `else`。

## OpenAPI

```bash
pnpm openapi:gen
```

生成文件：`../docs/openapi.yaml`。

当前导出基线为 39 个 HTTP 路径模板、52 个操作。运行时 Swagger 与静态 YAML 共用同一
配置和响应契约；生成过程会拒绝缺少 operation 映射的接口。每个操作都必须包含：

- 非空 description。
- 明确的成功响应 schema。
- 实际鉴权方案：后台 `adminJwt` 或调用方 `accessToken`。
- 参数/鉴权/权限/资源冲突等标准 4xx，以及统一错误响应 schema。

设备 WebSocket 协议不属于 HTTP OpenAPI，单独位于 `/api/client/ws`。

## 关键目录

```text
src/application/      业务模块
src/infrastructure/   config/db/redis/queue/search/ws
src/common/           guard/decorator/filter/db helper
src/scripts/          迁移、种子、OpenAPI、内部集成检查
drizzle/              SQL 迁移
test/                 纯接口黑盒冒烟与边界守卫
```

设备侧 Step 契约见 `../docs/device-app-audit.md`。
