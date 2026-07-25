# R2RPC 继续开发提示词

> 更新日期：2026-07-24。用于把当前仓库状态交给新的开发任务；重写开工阶段的旧提示词已归档到 `docs/archive/2026-07-08-新版开工提示词.md`。

```markdown
# R2RPC 全栈继续开发

仓库：`/Users/lpitiless/Documents/R2RPC`

## 当前事实

- 活代码在 `backend/`、`frontend/` 与 `sdk/`：NestJS 11 + Drizzle、Next.js 16 +
  shadcn、Android/Kotlin 和 JavaScript/TypeScript SDK。
- PostgreSQL 是业务权威库，Redis 承担 presence/队列/分布式协调，Manticore 保存 payload 和设备 AppAudit Step。
- API 与 Worker 是独立进程：`src/main.ts`、`src/worker.ts`。
- 设备使用 `dk_` device token 连接 `/api/client/ws`。
- 调用方使用 `rk_` access token 调 `POST /rpc/invoke/:project/:action`；令牌可按绝对时间或
  RPC 调用次数过期。
- 官方 SDK 位于 `sdk/android` 和 `sdk/javascript`，两端都提供 Device、Caller 和
  AppAudit Recorder。
- 设备可在 WS `result.appAudit` 上报 V1 执行 Step，契约见 `docs/device-app-audit.md`。
- 后台使用 JWT + CASL RBAC。
- `roles` 是权限组；读操作使用 `read/rbac`，所有 RBAC 写操作仅 `isRoot` 种子管理员可执行。
- 系统日志记录登录、控制面读取、Guard 拒绝和后台 mutation；mutation 通过 `@SystemAudit`
  记录准确的“谁在何时做了什么”，查询权限为 `read/system-log`。
- 19 条内置权限均有完整说明；后台手动 RPC 调试使用独立 `invoke/manual-rpc`，公开
  `/rpc/invoke/*` 继续使用 Access Token。
- 后台账号支持资料修改和改密；`isRoot` 管理员资料、密码、启停、删除和 RBAC 关系只能由本人修改。
- 后端 backlog #1–#15、管理前端 #16、手动 RPC #17、后台授权缓存 #18、统一配置/Compose
  #19、容器性能验收 #20、Android/JavaScript SDK #21 已全部完成。
- 管理前端 #16 已完成，覆盖全部后台管理公开面；默认端口 3001。
- 当前基线：OpenAPI 39 个路径模板 / 52 个操作 / 54 个 schema、后端 HTTP/WebSocket 黑盒
  180 passed、前端 Playwright
  12 passed、Jest 10 suites / 35 tests、JavaScript SDK 10 tests、Android SDK 8 tests。
- API、Worker、迁移、种子和前端共用根目录 `config.yaml` schema；根目录 `compose.yaml`
  提供 PostgreSQL、Redis、Manticore 和全部应用服务编排。
- 运行时 Swagger 由 `app.openApiEnabled` 控制，默认开启、生产关闭；静态
  `docs/openapi.yaml` 始终生成和提交。
- Compose 全部服务都有限制，CPU 声明上限合计 4.00 核、内存 3840 MiB；可选
  `performance` profile 默认挂 4 台虚拟 WS 设备，压测自动/随机设备 Hello 并生成 JSON 报告。
- 全部列表默认 10 条/页、最大 100 条/页；运行概览使用折线趋势图，请求详情使用宽版右侧
  抽屉，AppAudit Step 默认收起。
- 两类令牌均支持二次编辑 project；Access Token 还可二次编辑绝对过期时间与最大调用次数，
  且不会清零累计次数。更新立即失效鉴权缓存；次数受限的 invoke 以 PostgreSQL 原子计数，
  达到上限返回 `429`。
- Device Token 不设置过期时间，只能撤销或删除。
- 后台用户身份与权限快照使用公共 Redis cache-aside，默认 TTL 60 秒；Redis 未命中或异常时
  回源 PostgreSQL 并回写，RBAC、账号启停和软删除写入成功后立即删除受影响用户缓存。
- 令牌和 JSON 复制必须复用公共 `CopyButton`；非安全上下文使用兼容回退。

## 先读

1. `CLAUDE.md`
2. `docs/后端进度.md`
3. `docs/design-conventions.md`
4. `docs/项目总览-中文.md`
5. 改前端先读 `frontend/README.md`
6. 涉及设备日志时读 `docs/device-app-audit.md`
7. 涉及后台账号写入时读 `docs/superpowers/specs/2026-07-24-administrator-account-isolation-design.md`
8. 涉及权限组时读 `docs/superpowers/specs/2026-07-24-permission-groups-design.md`
9. 涉及后台写操作时读 `docs/superpowers/specs/2026-07-24-system-audit-logs-design.md`
10. 涉及前端架构时读 `docs/superpowers/specs/2026-07-24-management-frontend-design.md`
11. 涉及手动 RPC 时读 `docs/superpowers/specs/2026-07-24-manual-rpc-debugger-design.md`
12. 涉及配置或容器时读 `docs/superpowers/specs/2026-07-24-unified-configuration-compose-design.md`
13. 涉及性能测试或资源预算时读 `docs/superpowers/specs/2026-07-24-container-performance-suite-design.md`
14. 涉及客户端接入时读 `sdk/README.md` 与
    `docs/superpowers/specs/2026-07-24-device-sdks-design.md`
15. 与任务最接近的 source、test、schema 和历史 plan

## 修改规则

- 不直接提交 main；一功能一分支。
- 做最小范围改动，保留现有双进程和三套鉴权边界。
- schema 改动必须生成并提交 Drizzle 迁移。
- 非日志实体继续遵守 description + deleted_at + partial unique。
- 变量/参数使用完整语义名，禁止单/双字母和 `cfg/ctx/req/res/dto/tx/svc` 等含糊缩写。
- 优先保护子句和职责拆分；圈复杂度不得超过 10、嵌套不得超过 3、单函数语句不得超过 40。
- 事务内所有写都使用同一 `transaction`。
- API 热路径不做慢 IO，冷路径进入 BullMQ Worker。
- 代码注释使用中文。
- 任何以用户为目标的新写入口都必须接入 `AdministratorAccountPolicyService`，请求者编号只取 JWT 上下文。
- 所有 RBAC 写入口必须叠加 `RootGuard`；权限组读取必须批量组装，禁止 N+1。
- JSON 缓存必须复用 `RedisCacheAsideService.getOrLoad/writeAndInvalidate`，禁止业务模块
  各自重复实现 Redis fallback、回写和写后删除。
- 新增内置权限必须同时提供准确 description，并由幂等种子更新已有记录；不同凭证边界的能力
  必须使用不同权限语义。
- 新增后台 mutation 必须声明 `@SystemAudit`；自动访问审计只列安全 metadata，禁止记录
  密码/token 明文，也不得把 RPC/WS 数据面重复写入系统日志。
- 前端只能打公开 HTTP API；RBAC 显隐不能替代后端 Guard。
- 前端复制功能必须使用 `CopyButton`/`lib/clipboard.ts`，禁止页面直接调用
  `navigator.clipboard.writeText`。
- 列表保持默认 10、最大 100 的分页规则；稳定短字段可筛选，长载荷、说明、令牌明文和高变化
  扩展字段不作为筛选项。
- 前端页面/组件/E2E 同样禁止含糊缩写，优先公共原语但不做 mega CRUD 抽象。

## 必跑验证

在 `backend/`：

```bash
node_modules/.bin/nest build
pnpm lint:check
node_modules/.bin/prettier --check "src/**/*.ts" "test/**/*.{ts,js}"
node_modules/.bin/jest --runInBand
pnpm smoke
pnpm performance
```

`pnpm smoke`/`pnpm test:e2e` 必须只访问运行中的 HTTP/WS 接口。禁止 E2E 导入应用模块、数据库/Redis/Manticore 客户端或执行查询；`test/assert-blackbox-e2e.js` 会检查这一边界。

在 `frontend/`：

```bash
pnpm lint
pnpm build
pnpm test:e2e
```

前端 Playwright 也只能通过浏览器与公开 HTTP API 验证，边界由
`test/assert-blackbox-e2e.cjs` 强制；当前基线为 12 passed。

在 `sdk/`：

```bash
(cd javascript && corepack pnpm check)
(cd android && ./gradlew :r2rpc-sdk:testDebugUnitTest :r2rpc-sdk:assembleRelease)
```

SDK 测试只能走公开 HTTP/WebSocket 协议，不得导入后端模块或直连持久层。

底层 retention/stale/metrics/maxInFlight 算法的直连检查属于 `pnpm test:integration:*`，不得称为 E2E。

## 当前优先事项

1. 建 CI：build、lint、format、unit、黑盒 E2E。
2. 增加 `/health` 与 `/ready`。
3. 从现有 Compose 契约派生 Kubernetes 示例和生产 secret 注入。
4. 为 WS 内部 `receiver.getInfo` 兼容性补充升级回归。

## 文档

- 功能完成后更新 `docs/后端进度.md` 和 `CHANGELOG.md`。
- API 变化后执行 `pnpm openapi:gen` 并提交 `docs/openapi.yaml`。
- 行为、配置、命令变化必须同步更新 README、backend/README、deploy/README 和相关设计文档。
- SDK 契约变化必须同步两个 SDK、`sdk/README.md`、AppAudit 协议和 SDK 设计。
```
