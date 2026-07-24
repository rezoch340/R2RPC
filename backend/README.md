# RER0RPC Backend

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

默认读取当前目录的 `config.yaml`，可用 `CONFIG_FILE` 指向其他 YAML。

```bash
cp config.example.yaml config.yaml
```

配置包含：

- `app.port`、`app.globalPrefix`、`app.publicWsUrl`
- PostgreSQL
- Redis
- JWT
- Manticore
- 原始日志和日聚合保留策略

配置由 zod 校验，非法值会让进程启动失败。

API 默认允许浏览器跨域访问。生产环境可设置 `CORS_ORIGIN` 为允许的控制台 Origin，多个值用
逗号分隔；例如 `CORS_ORIGIN=https://console.example.com`。

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
- 没有 schema 变化；部署后重跑 `pnpm seed:admin` 即可补齐 `read/rbac`。

完整设计见 `../docs/superpowers/specs/2026-07-24-permission-groups-design.md`。

## 系统操作审计

- `system_logs` 是不可变追加表，包含 `name`、`description`、操作者、动作、对象、结果、IP 和时间。
- `GET /system-logs` 使用 `read/system-log`，支持操作者、action、subject、状态、时间和分页筛选。
- 登录成功/失败、JWT 控制面读取、Guard/路由阶段拒绝和后台 mutation 全部记录；mutation
  继续显式声明 `@SystemAudit` 以提供准确业务名称和对象。
- metadata 只读取声明的安全 path/body/query 字段，不复制完整请求体，密码与 token 明文不会入库。
- RPC invoke、设备 WebSocket 与 AppAudit 使用各自日志链路，不重复写入高频系统访问日志。
- 系统日志没有修改或删除 API，也不与 RPC `request_logs`、设备 AppAudit 混用。

完整设计见 `../docs/superpowers/specs/2026-07-24-system-audit-logs-design.md`。

## 测试

### 单元测试

```bash
pnpm test
```

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
- 覆盖登录成功/失败、控制面读取、Guard 拒绝、业务写入、筛选和密码不泄露
- 通过 monitor/metrics API 观察 Worker 冷路径
- 当前为 143 项运行时检查

`test/assert-blackbox-e2e.js` 会拒绝 E2E 导入持久层客户端或应用内部服务。

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
