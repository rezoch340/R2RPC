# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

RER0RPC 是设备侧 RPC 中继平台(思路类似 Sekiro):调用方按 `project`(功能组)或指定 `clientId`,把请求下发到在线设备,设备执行后实时回传结果。活代码位于 `backend/`(NestJS API/Worker)与 `frontend/`(Next.js 管理控制台)。

当前文档已经统一为 NestJS + PostgreSQL + Redis + BullMQ + Manticore 架构，端口 **3000**，默认管理员 `admin/admin123456`。旧 Go/MySQL 文档只保存在 `docs/archive/`，不得作为当前实现依据。

## 动手前先读

- **`docs/后端进度.md` 是唯一进度台账** —— 确认当前 epic/子项、已完成项。规则:一功能一分支,完成即在该文件勾 ✅ + 补「完成记录」,和代码同 PR 合入 main(进度跟 git,不靠会话记忆)。
- **`docs/design-conventions.md`** —— 工程约定(分层、并发、事务、缓存、请求日志),动手前必读。
- 设计定稿/实现计划在 `docs/superpowers/{specs,plans}/`。

## 命令(在 `backend/` 下跑)

> ⚠️ **本机 pnpm 坑**:`pnpm <script>` 会先跑一次 `pnpm install`(verify-deps),沙箱里可能失败即中断脚本。若 `pnpm build` 之类报 pnpm install 错,改直接调二进制:`node_modules/.bin/{nest,eslint,prettier,drizzle-kit,ts-node}`。

```bash
pnpm build                 # nest build。提交/PR 前必过:build + lint + format
pnpm lint:check            # 命名 + ESLint，只检查不修改
pnpm lint / pnpm format    # 命名门禁 + eslint --fix / prettier
pnpm start:api             # API 进程(HTTP + WS 网关,端口 3000)
pnpm start:worker          # Worker 进程(独立!--entryFile worker)
pnpm db:generate           # drizzle-kit 从 src/**/*.schema.ts 生成迁移(见坑)
pnpm db:migrate            # 应用迁移(独立步骤,绝不在 app 启动时跑)
pnpm seed:admin            # 种子 admin + demo projects + RBAC 权限(幂等,可重跑)
pnpm smoke                 # 172 项纯 HTTP/WS 黑盒完整性冒烟，需 API+Worker 在跑
pnpm test:e2e              # 与 smoke 相同；先执行黑盒边界守卫
pnpm test:integration:retention | test:integration:device-stale
pnpm test:integration:metrics | test:integration:max-inflight # 内部直连检查，明确不是 E2E
pnpm test                  # Jest 单测(*.spec.ts)
```

## 前端命令(在 `frontend/` 下跑)

```bash
pnpm dev                   # Next.js 开发服务器,端口 3001
pnpm lint                  # 命名门禁 + ESLint
pnpm build                 # 生产构建
pnpm test:e2e              # 12 项浏览器黑盒,只访问 UI 与公开 HTTP API
```

前端使用 Next.js + shadcn，并严格按 RER0RPC OpenAPI 实现页面与类型。
管理页不得导入后端内部模块或直连数据库/Redis/Manticore；RBAC 前端显隐不是安全边界，最终授权
仍由后端 Guard 决定。API 默认允许 CORS，生产用 `CORS_ORIGIN` 限定控制台来源。
令牌和 JSON 复制统一使用 `CopyButton`/`lib/clipboard.ts`，禁止页面直接调用
`navigator.clipboard.writeText`；公共实现会在非安全上下文自动回退。全部列表默认 10
条/页、最大 100 条/页。

- **前置基础设施**:PostgreSQL / Redis / Manticore 按 `config.yaml`(默认 `localhost:5432/6379/9308`)须已在跑；仓库提供 `deploy/docker-compose.yml` 与 `deploy/dev-up.sh`。配置走 `CONFIG_FILE`(默认 `./config.yaml`,`config.example.yaml` 是模板),zod 校验失败即启动失败。
- **drizzle 迁移坑**:`db:generate` 在**同一次同时 drop 旧表 + 建新表**时,会交互式问"rename vs create"——非交互环境会卡住,须明确回答(拆表/新表通常选 **create**)。纯 ADD COLUMN / 只新增表不问。改破坏式迁移前确认 `docs/后端进度.md` 里该阶段允许破坏。

## 双进程架构(关键)

**API 进程与 Worker 进程分开部署**,各自扩缩容:

- **API**(`main.ts` / `AppModule`):HTTP 路由 + WS 网关(`infrastructure/ws`)。**热路径**只做校验 + 核心业务 + **入队**,亚毫秒返回,不碰慢 IO / 外部请求。
- **Worker**(`worker.ts` / `WorkerModule`):BullMQ 消费者(`RequestLogProcessor` / `DeadLetterProcessor` / `MaintenanceProcessor`)+ `WorkerBootstrap` 挂的定时维护(`repair-stale-pending` / `retention-sweep` / `mark-devices-stale` / `metrics-cleanup`)+ 启动对账。**Processor 只注册在 WorkerModule**,别塞进 AppModule(否则 API 也去消费队列、双跑)。
- 共享状态只在 **PG(权威)+ Redis(在线态/缓存/分布式锁)**;进程内不留跨请求状态(无状态、可水平扩容)。跨实例 WS 派发/结果路由经 `ClusterBus`(Redis pub/sub)。

## Device-model 三概念(`src/application/`)

- **project**(`projects/`,旧名 group):功能组;设备与两类 token 都挂到它上。
- **device token**(`device-token/`,明文前缀 `dk_`):设备**自注册上线**凭证,可二次编辑 project;设备继承该 token 的 project(不自报能力),作用域更新会断开旧连接后重连。
- **access token**(`access-token/`,前缀 `rk_`):**调用方 invoke** 凭证,可二次编辑 project，更新后立即清除鉴权缓存。
- 旧 client-login(clients/client_groups/密码登录)**已删**,设备一律 device-token 自注册(WS `?token=<dk_>&clientId=<SDK自生成>`)。

## 两条主链路

**invoke(热)** `POST /rpc/invoke/:project/:action`(`@Public` + `AccessTokenGuard` 校验 token 有该 project,非用户 JWT):
project→id → `PresenceService.pickOnlineAcquire` 从 Redis `project:clients:{projectId}` 轮询选在线设备并占槽(或 `?clientId=` 指定)→ `ConnectionRegistry` 注册 waiter + `markWaiting` → `dispatchJob`(本地或经 ClusterBus 跨实例)→ 设备 WS 回 `result`(可带 AppAudit V1)→ `handleResult`(`rpc:completed` 去重 + 路由回等待实例)resolve → 校验审计 → `enqueueRequestLog` 入队(冷)。

**请求日志/指标(冷)**:`RequestLogProcessor` 消费 REQUEST_LOG 队列 → `writeSpine` 写 PG `request_logs`(取证脊柱,标量列,幂等,**返回是否首插**)→ 索引 payload + 设备 AppAudit Step 到 Manticore → 标 indexed;**首插时**顺带 `MetricsService.recordCompletion` 累加日聚合(靠首插判去重,BullMQ 重试不重复计)。列表查 PG 脊柱(不返 payload/AppAudit),详情按 requestId 从 Manticore 懒加载。指标:`device_daily_metrics`/`rpc_daily_metrics` per-completion upsert 自增;Worker 启动 `rebuildRecent` 从 request_logs 重灌最近 N 整天对账;`metrics-cleanup` 按 `aggregateRetentionDays` 清理。

## DB 约定

- **Drizzle**:表定义 `{module}.schema.ts`(`pgTable`);`drizzle.config.ts` 用 glob(`src/**/*.schema.ts`)收集。schema 改了 → `db:generate` + `db:migrate`。
- **实体表铁律**:非日志表必须有 `description` + 软删(`deleted_at` + `alive()`/`softDelete()`,来自 `src/common/db/soft-delete.ts`),token/name 唯一走 **partial unique**(`WHERE deleted_at IS NULL`);读一律过 `alive()`。
- **日志/派生表豁免**(硬清理、可从别处重建):`request_logs`、`*_daily_metrics` —— 不加 description/deleted_at。
- **系统审计例外**:`system_logs` 是不可变追加日志，但为了直接展示“谁做了什么”明确保留
  `name + description`；不加 `deleted_at`，也不提供修改/删除 API。
- **设备 AppAudit**：只认 WS `result.appAudit` 保留字段，V1 契约/限制见 `docs/device-app-audit.md`；非法审计整体丢弃但不影响 RPC。
- **缓存 cache-aside + 写即删**：统一复用 `RedisCacheAsideService.getOrLoad/writeAndInvalidate`；
  Redis 未命中或异常时回源 PG 并回写，写库成功后删除 key。用户授权缓存默认 60 秒，
  RBAC/账号启停/软删除写入必须失效相关用户缓存；令牌撤销、软删和作用域更新同样走公共组件。
  presence（WS 上线/心跳/断开）是主动写。
- 迁移**独立步骤**跑,绝不在 app 启动时改库。

## RBAC

CASL;权限是 DB `permissions` 行,`(action, subject)` **free-form**(新 subject 无需代码注册)。controller 上加 `@RequirePermission('read','device')`;`PermissionGuard` 里 `user.isRoot` 直通全部。加权限 = 往 `src/scripts/seed-admin.ts` 的 `ALL_PERMISSIONS` 增加 action、subject 和完整 description 后再运行 `seed:admin`。当前手动 RPC 控制面使用独立 `invoke/manual-rpc`，不能复用公开数据面的 Access Token。

`roles` 就是权限组：用户可属于多个权限组，权限取有效组的并集。权限组/权限目录/用户分组的
读接口使用 `read/rbac`；所有 `/rbac/*` 写接口必须同时挂 `RootGuard`，只有
`request.user.isRoot=true` 的种子管理员可写，`manage/rbac` 不能替代身份闸。权限组列表和用户
权限组列表返回嵌套 `permissions`，批量组装，不得写成 N+1。设计见
`docs/superpowers/specs/2026-07-24-permission-groups-design.md`。

`users.isRoot=true` 的种子管理员账号只有本人能写。所有以用户为目标的资料、密码、enabled、软删除和
RBAC 角色绑定/解绑都必须先调用 `AdministratorAccountPolicyService`，请求者编号只取
`request.user.id`。`users.role` 是遗留展示字段，不参与授权或管理员保护。设计见
`docs/superpowers/specs/2026-07-24-administrator-account-isolation-design.md`。

后台业务写端点必须显式增加 `@SystemAudit(...)`；登录与所有 JWT 控制面读取由全局拦截器
自动记录，Guard/路由阶段拒绝由全局异常过滤器补记。只把安全 path/body/query 字段列入
metadata 白名单，禁止复制完整请求体或记录密码/token 明文。RPC invoke、设备 WS 和
AppAudit 继续走各自日志链路，不重复写 `system_logs`。系统操作日志通过 `GET /system-logs`
(`read/system-log`) 查询；它与 RPC `request_logs`、设备 AppAudit 是三类不同日志。设计见
`docs/superpowers/specs/2026-07-24-system-audit-logs-design.md`。

## 协作铁律

- **不直接提交 main**:功能分支 → PR → 合并 → 同步主干、清分支。commit 用 emoji + 中文。
- **注释中文**,放被注释代码**上一行**(非行尾)。
- **并发读-改-写**优先级:原子语句(`UPDATE ... SET n=n+1`,drizzle 用 `sql` 自增)> 行锁事务(`.for('update')`)> Redis 分布式锁(fail-open)。
- **命名与控制流**:变量/参数写完整语义，禁止单/双字母和 `cfg/ctx/req/res/dto/tx/svc` 等含糊缩写；优先保护子句和职责拆分，圈复杂度 ≤ 10、嵌套 ≤ 3、单函数语句 ≤ 40。`pnpm lint:check` 是强制门禁。
- **事务**:写库方法收可选 `transaction?` 句柄(传了复用调用方事务、没传自开);执行函数内所有写一律走 `transaction`,**绝不**用全局 `this.database`。
- **E2E 只走公开接口**:`test/smoke.e2e.js` 只能使用 HTTP/WS；禁止导入应用模块、数据库/Redis 客户端或执行 SQL。Worker 冷路径通过 monitor/metrics API 观察；`test/assert-blackbox-e2e.js` 防止边界回退。
- retention/stale/metrics/maxInFlight 的底层直连脚本统一命名 `*.integration.ts`，只能作为 `test:integration:*` 内部算法检查，**不得称为 E2E/冒烟**。
- 别默认建 `repository.ts`;新模块用 `nest g`(不手写样板),schema 用 Drizzle 替掉 CLI 的 `entities/`。
