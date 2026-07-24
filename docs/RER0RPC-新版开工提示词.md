# RER0RPC 继续开发提示词

> 更新日期：2026-07-24。用于把当前仓库状态交给新的开发任务；重写开工阶段的旧提示词已归档到 `docs/archive/2026-07-08-新版开工提示词.md`。

```markdown
# RER0RPC 后端继续开发

仓库：`/Users/lpitiless/Documents/RER0RPC`

## 当前事实

- 活代码全部在 `backend/`，NestJS 11 + TypeScript + Drizzle。
- PostgreSQL 是业务权威库，Redis 承担 presence/队列/分布式协调，Manticore 保存 payload 和设备 AppAudit Step。
- API 与 Worker 是独立进程：`src/main.ts`、`src/worker.ts`。
- 设备使用 `dk_` device token 连接 `/api/client/ws`。
- 调用方使用 `rk_` access token 调 `POST /rpc/invoke/:project/:action`。
- 设备可在 WS `result.appAudit` 上报 V1 执行 Step，契约见 `docs/device-app-audit.md`。
- 后台使用 JWT + CASL RBAC。
- `roles` 是权限组；读操作使用 `read/rbac`，所有 RBAC 写操作仅 `isRoot` 种子管理员可执行。
- 后台账号支持资料修改和改密；`isRoot` 管理员资料、密码、启停、删除和 RBAC 关系只能由本人修改。
- 后端 backlog #1–#14 已全部完成。

## 先读

1. `CLAUDE.md`
2. `docs/后端进度.md`
3. `docs/design-conventions.md`
4. `docs/项目总览-中文.md`
5. 涉及设备日志时读 `docs/device-app-audit.md`
6. 涉及后台账号写入时读 `docs/superpowers/specs/2026-07-24-administrator-account-isolation-design.md`
7. 涉及权限组时读 `docs/superpowers/specs/2026-07-24-permission-groups-design.md`
8. 与任务最接近的 source、test、schema 和历史 plan

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

## 必跑验证

在 `backend/`：

```bash
node_modules/.bin/nest build
pnpm lint:check
node_modules/.bin/prettier --check "src/**/*.ts" "test/**/*.{ts,js}"
node_modules/.bin/jest --runInBand
pnpm smoke
```

`pnpm smoke`/`pnpm test:e2e` 必须只访问运行中的 HTTP/WS 接口。禁止 E2E 导入应用模块、数据库/Redis/Manticore 客户端或执行查询；`test/assert-blackbox-e2e.js` 会检查这一边界。

底层 retention/stale/metrics/maxInFlight 算法的直连检查属于 `pnpm test:integration:*`，不得称为 E2E。

## 当前优先事项

1. 建 CI：build、lint、format、unit、黑盒 E2E。
2. 增加 `/health` 与 `/ready`。
3. 增加 API/Worker 生产 Dockerfile 和部署编排。
4. 硬化 clientId 与 clientQueue 的 project 隔离。
5. 为后台权限查询增加失效明确的短 TTL 缓存。

## 文档

- 功能完成后更新 `docs/后端进度.md` 和 `CHANGELOG.md`。
- API 变化后执行 `pnpm openapi:gen` 并提交 `docs/openapi.yaml`。
- 行为、配置、命令变化必须同步更新 README、backend/README、deploy/README 和相关设计文档。
```
