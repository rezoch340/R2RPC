# 工程设计规范

> 适用于 **NestJS 后端 + Next.js(App Router)前端**的通用工程约定。新人 / 开发 Agent 动手前先读这篇。

---

## 一、后端设计规范

### 技术栈

- 包管理统一 **pnpm**:`pnpm install` / `pnpm add` / `pnpm dlx`(等价 `npx`)/ `pnpm run`,
  锁文件 `pnpm-lock.yaml`。**不混用 npm / yarn。**
- 脚手架统一 **NestJS CLI**:模块骨架用 `nest g` 生成,**不手写样板代码**(见「脚手架」一节)。
- ORM 用 **Drizzle ORM**(SQL-first、全类型、无 codegen,迁移用 **drizzle-kit**)。
- 基线:NestJS + Drizzle + PostgreSQL + Redis + 队列(BullMQ)+ 全文搜索(Manticore / ES 类)+
  JWT + RBAC + Swagger。

### 目录规范 —— 按 nest-cli 官方输出走(强约束)

**目录 / 文件名一律用 NestJS CLI 生成的官方结构,不重命名、不重排**——CLI 出啥就用啥,
这才是省 token 的关键(见「脚手架」)。业务代码进 `src/application/{module}/`:

```text
src/application/{module}/
├── dto/
│   ├── create-{module}.dto.ts   # 请求 DTO
│   └── update-{module}.dto.ts
├── {module}.schema.ts          # Drizzle 表定义(pgTable),替代 nest-cli 的 entities/
├── {module}.module.ts
├── {module}.controller.ts       # REST 入口
└── {module}.service.ts          # 业务逻辑
```

- **REST 入口用 `{module}.controller.ts` / `XxxController`**(CLI 官方命名,带模块前缀)。
- **默认不建 `repository.ts`**,只有查询复杂或多处复用才建。
- 仅内部 provider 模块(无公开 REST)可只留 `module.ts` + `service.ts`。

### 脚手架(用 nest-cli,别手写样板)

新模块**一律用 NestJS CLI 生成**,人只填业务——省下大量样板 token,也保证结构一致。
**接受 CLI 的默认输出,不改名、不挪目录:**

```bash
# 一条命令铺满整个模块(REST 端点 + CRUD 骨架 + dto/ + entities/),选 REST、不生成 spec
pnpm dlx @nestjs/cli g resource application/{module} --no-spec

# 不需要 CRUD 样板时,单独生成三件套(各自落在 {module}/ 下,自动注册进最近的 module):
pnpm dlx @nestjs/cli g module      application/{module}
pnpm dlx @nestjs/cli g controller  application/{module}
pnpm dlx @nestjs/cli g service     application/{module}

# 装了本地依赖后可直接用 nest
nest g resource application/{module} --no-spec
```

- CLI 会生成 `{module}.controller.ts` / `{module}.service.ts` / `dto/`(外加一个 `entities/`),
  **这就是本项目的目录规范**——生成完直接写业务,别再回头改名或搬目录。
- **DB schema 用 Drizzle**:删掉 CLI 生成的 `entities/`,改用 `{module}.schema.ts`(`pgTable(...)`);
  `drizzle.config.ts` 用 glob(如 `src/**/*.schema.ts`)收集所有表交给 drizzle-kit 生成迁移。
- `--no-spec` 不生成 `*.spec.ts`(测试单独组织,见「测试规范」)。

### 分层职责

- `{module}.controller.ts`:只做 API 入口、Swagger、Guard、DTO、调 service。不处理 HTTP req/res 之外的业务。
- `{module}.service.ts`:全包业务逻辑(Drizzle / Redis / 队列 / 事务 / 外部调用)。

### 全局规则

- **Library First**:优先用成熟库(ioredis / BullMQ / class-validator / `@nestjs/swagger` /
  `@nestjs/config` + YAML / axios·undici / `crypto` AES-GCM),库不够才自研。
- 所有配置来自集中配置文件(如 `config.yaml`,`CONFIG_FILE` 指定),**校验失败即启动失败**。
- 所有异步任务走队列;所有 API 有 Swagger + validation;所有权限走 Guard / Decorator。

### 命名与控制流（强制门禁）

- 变量、参数和 `catch` 绑定必须写完整语义；禁止单字母/双字母名称，以及 `cfg`、`ctx`、`req`、`res`、`resp`、`msg`、`proj`、`cond(s)`、`opts`、`params`、`obj`、`arr`、`fn`、`cb`、`err`、`idx`、`dto`、`tx`、`svc`、`doc` 等含糊缩写。
- HTTP、URL、JWT、RPC、WS、ID 等稳定协议/领域术语可以保留；这不是允许自行发明缩写。
- 禁止用嵌套三元表达式代替业务分支；优先使用提前返回、保护子句、语义明确的私有方法和按职责拆分。
- 单函数圈复杂度不得超过 10、嵌套深度不得超过 3、语句数不得超过 40；所有条件分支必须使用花括号，能提前返回时不得保留多余 `else`。
- `pnpm lint` 和 `pnpm lint:check` 会先执行 `test/assert-readable-source.js`，再由 ESLint 检查复杂度、深度、函数长度和控制流；规则覆盖 `src/` 及测试中的变量命名。

### 后台管理员账号隔离

- `users.isRoot=true` 是受保护种子管理员，只能由该账号本人修改；其他请求者即使拥有
  `update/user`、`delete/user` 或 `manage/rbac` 也必须返回 403。
- 请求者编号只能从 JWT 鉴权后的 `request.user.id` 读取，禁止由请求体声明。
- 所有直接以用户为目标的写路径共用 `AdministratorAccountPolicyService`，当前包括资料、密码、
  enabled、软删除和 RBAC 用户角色绑定/解绑；新增用户写入口时必须接入同一策略。
- `isRoot` 只能由种子流程维护，任何 HTTP API 均不得授予、撤销或修改。
- `users.role` 是遗留展示字段，不参与 CASL 授权，也不作为受保护管理员判据。
- 用户管理响应必须显式选择安全字段，禁止返回 `passwordHash`。

### 权限组与 RBAC 写隔离

- `roles` 是权限组，`user_roles` 允许用户属于多个权限组，用户最终权限是所有有效组权限的并集；
  `users.role` 不得用于授权或分组。
- 权限组读取使用 `read/rbac`，返回组内完整 `permissions`；列表查询必须固定次数批量组装，
  禁止按权限组逐条查询。
- 权限组、权限目录和用户分组的所有 RBAC 写入口除 `manage/rbac` 外必须叠加
  `RootGuard`；只有 JWT 身份中的 `isRoot=true` 可写，普通用户不能通过被委派
  `manage/rbac` 绕过身份闸。
- 新增请求体形式的关联接口时保留现有 URL 形式兼容入口，两个入口必须调用同一 service 方法。
- 每条内置权限必须有准确、可直接展示的 `description`；种子必须同时创建新权限并幂等更新
  已存在内置权限说明，禁止只写难以理解的 action/subject。
- 不同凭证域必须使用独立权限语义：后台手动 RPC 使用 `invoke/manual-rpc`，公开 RPC 继续由
  Access Token 作用域授权，不得用前端显隐或另一个管理权限代替。
- `isRoot` 用户修改其他受保护管理员的组关系时仍须经过
  `AdministratorAccountPolicyService`，身份闸不能绕过账号隔离策略。

### 令牌作用域更新

- 两类令牌的 project 作用域更新都使用完整集合替换，必须在事务内校验 project、删除旧关联并
  写入新关联；禁止逐项写入导致半更新。
- Access Token 更新成功后立即删除 Guard 缓存；Device Token 更新成功后删除 WS 鉴权缓存，
  再发布 `ws:device-token-scope-changed` 集群事件。
- 每个 API 实例都必须订阅 Device Token 作用域事件，并以 close `4002` 断开该 token 的本地
  连接；设备重连后只能从服务端返回的新作用域恢复。
- 令牌作用域 mutation 必须接入系统审计，但 metadata 不得包含 token 明文。

### 表的名称与描述

- 业务实体必须有稳定的语义名称和 `description`；语义名称可以是 `name`、`username`、
  `clientId` 或权限的 `action + subject`，禁止为了形式统一重复增加一个会漂移的 `name`。
- 多对多关系表由复合外键唯一表达关系，不增加独立 `name`；可保留 `description` 说明关系。
- 请求日志和派生聚合不是可命名实体，按日志/派生表规则豁免。
- `system_logs` 为满足人类直接阅读，明确包含操作 `name` 和完整摘要 `description`。

### 系统操作审计

- 后台业务 mutation 必须显式添加 `@SystemAudit`，名称应能直接组成“操作者 + 操作 + 对象”。
- 登录成功/失败和全部 JWT 控制面读取由全局拦截器自动记录；Guard/路由阶段拒绝由全局异常
  过滤器补记，并用请求标记避免与拦截器重复写入。
- 审计 metadata 只能列出已确认安全的 path/body/query 白名单字段；禁止复制完整 body，密码和两类
  token 明文永远不能进入系统日志。
- `system_logs` 是不可变追加事实，不使用软删除，不提供更新或删除 API。
- 公开 Access Token RPC、设备 WebSocket 与 AppAudit 属于数据面，继续写请求日志/协议日志，
  不进入高频控制面系统日志；后台 JWT 手动 RPC 是低频管理操作，必须另写白名单系统审计，
  但 Payload 只进入请求日志，不进入系统日志。
- 审计写入失败只记录服务端 error，不得把已成功的业务操作伪装成失败。

### 架构原则:分布式 + 冷热路径

**可分布式部署**:app 实例**无状态**,可水平扩容;状态只放共享存储。

- API 服务、异步 Worker、网关按角色拆成**独立进程**,各自独立扩缩容(别把 Worker 塞进 API 进程)。
- 共享状态放 **PostgreSQL(权威)/ Redis(缓存 + 分布式锁)**;进程内不留跨请求状态。
- 跨实例的读-改-写并发,见「并发控制」一节。

**冷热路径分离**:请求热路径只做「响应客户端必需」的事,其余全甩给冷路径(队列 + Worker)。

- **热路径**(客户端同步等待):校验 + 核心业务 + **入队**,亚毫秒完成,**不碰重存储 / 慢 IO / 外部请求**。
- **冷路径**(异步 Worker):写日志、建全文索引、数据同步、发 webhook 等非关键 / 慢操作。
- 冷路径失败**不影响**热路径响应;失败进重试队列,多次失败进死信队列。
- 请求日志就是典型应用(见下)。

### 并发控制:分布式锁 + 行锁原子更新

读-改-写(read-modify-write)一律走**两层防并发**,跨实例、跨事务都不脏写:

1. **分布式锁(Redis)——跨实例第一道闸**:进临界区前先抢锁(`SET NX PX` + 唯一 token,
   释放用 Lua 校验 token 再 `DEL`,避免误删别人的锁)。作用是降竞争 / 快速失败;
   **Redis 挂则 fail-open**,不因缓存层故障阻断业务。
2. **数据库行锁(权威)——原子更新**:在**同一事务内** `SELECT ... FOR UPDATE`(Drizzle:`.for('update')`)
   锁住目标行,读-改-写在事务里一气呵成 → **原子更新**。这才是正确性保证,**Redis 锁失效 / 没抢到也仍生效**。
3. **能一条原子语句搞定就别读-改-写**:如 `UPDATE t SET n = n + 1`(Drizzle 用 `db.update().set()` 配 `sql` 自增片段),
   或乐观锁 `... WHERE version = ?`(受影响行数为 0 即冲突,重试)。
   **优先级:原子语句 > 行锁事务 > 分布式锁**,越靠上越省。

### 事务:方法收可选事务句柄,可组合

写库方法**接收一个可选的事务句柄** `transaction`:**传了就加入调用方的事务,没传就自己开一个新事务**。
这样多个写方法嵌套调用能合进**一个事务**(要么全成要么全滚),单独调用又能独立跑。

```ts
// 事务句柄类型:从 database.transaction 回调参数推导,免得手写冗长泛型
type DatabaseTransaction = Parameters<
  Parameters<typeof database.transaction>[0]
>[0];

async fillAndSave(input: {
  /* … */
  transaction?: DatabaseTransaction;
}) {
  const execute = async (transaction: DatabaseTransaction) => {
    // 所有写操作都走 transaction
    // transaction.insert(...).values(...) / transaction.update(...)…
    // …
    return result;
  };
  // 传了句柄 → 复用调用方事务;没传 → 开新事务
  return input.transaction
    ? execute(input.transaction)
    : this.database.transaction(execute);
}
```

- **关键纪律**:`execute` 里所有写操作一律走参数里的 `transaction`,**绝不**直接用全局 `this.database`——
  否则那步脱离事务,回滚时漏掉、破坏原子性。
- 下游 service 也照此签名(`transaction?` 一路往下透传),整条调用链共用同一个事务。
- **Drizzle 支持 savepoint 真嵌套**:`transaction.transaction(...)` 可开子事务、回滚到中间点(Prisma 做不到)。
- 若不希望逐层透传 `transaction`，可使用 `@nestjs-cls/transactional-adapter-drizzle-orm`
  通过 AsyncLocalStorage 自动传播。

### 缓存:cache-aside + 写即失效

统一 **cache-aside(旁路缓存)+ 写即失效**,杜绝脏数据:

- **公共组件**：JSON 缓存必须复用 `RedisCacheAsideService` 的 `getOrLoad`、
  `writeAndInvalidate` 和 zod 契约校验，不得在业务 Service/Guard 里重复实现 Redis
  `get/set/del`、回源、回写和异常降级。
- **读**:先查缓存,命中即返回;**未命中读库,回填缓存**再返回(设 TTL 兜底)。
- **写 / 改 / 删**:先落库(权威源),**再删除**对应缓存 key(**失效,不是更新**),下次读自然回填最新值。
- **删而不更新**:直接更新缓存在并发下有「写覆盖」竞态、易留脏值;删除最简单、最不易脏。
- **顺序与降级**：先写库、后删缓存；Redis 故障不能回滚已成功的权威库写入，公共组件记录失败，
  TTL 承担最终一致性兜底。
- **用户授权**：身份与权限快照 TTL 默认 60 秒、配置下限 60 秒；权限组挂载/移除权限、权限或
  权限组删除、用户分组/移组、账号启停和软删除必须失效全部受影响用户缓存。

### 请求日志(取证脊柱 + 全文镜像)

请求日志一条数据**分两处存,各司其职**:

| 存储 | 存什么 | 角色 |
|---|---|---|
| **关系库(PostgreSQL)** | **取证脊柱**:标量列(`id / type / method / route / statusCode / latencyMs / createdAt`)+ 标识列(如 `projectId / tokenId / appCode`) | 权威、可按标量/标识过滤;**不含原始 payload JSON** |
| **全文库(Manticore / ES 类)** | 上述列 + **完整原始 payload / AppAudit(JSON)** | 全文搜索 + 原始 payload、设备执行 Step 存储 |

- **为什么不把 payload 塞进关系库**:请求日志是高频 append 表,`requestBody/Headers/responseBody`
  可以很大,直接灌进关系库会撑爆、拖慢。原始 payload 只落全文库,关系库只留可查的脊柱。
- **两边共用 `id`**:worker 先写关系库拿 `id`,再当全文库文档的 `logid`,取证时互查。
- **写入异步化**:请求热路径只入队(队列),写库在 worker 里做;全文库失败不影响主请求,重试耗尽进死信队列。
- **读取走全文库镜像**:列表**不返 payload/AppAudit**(轻量);详情按 `logid` **懒加载**单条原始数据。

### 设备 AppAudit Step

- 设备内部业务调用只在设备端可见，必须由设备随最终 WS `result.appAudit` 批量上报；服务端不得根据最终 payload 伪造内部 Step。
- `appAudit` 是 Core 协议保留字段，`payload.appAudit` 仍按普通业务 payload 处理。
- 服务端在 RPC 热路径只做有界结构校验和入队，不同步写 Manticore；非法审计整体丢弃但不得使 RPC 失败。
- PostgreSQL 只留请求日志脊柱，完整 metadata/steps/request/response/error 只进 Manticore。
- 当前 V1 契约、体积/数量限制和设备记录器行为以 `docs/device-app-audit.md` 为准。
- 第一版只支持最终批量快照；没有最终 `result` 的断线/超时请求不会拥有设备内部 Step。

### 禁止事项

- 默认建 `repository.ts`
- `service` 直接处理 HTTP request / response
- 生产环境启动时自动改库(migration 走独立步骤,不在 app 启动里跑)
- 输入不校验、权限不设 Guard
- 把请求 payload 原文灌进关系库
- 在请求热路径里做慢 IO / 同步写全文库 / 发外部请求(应入队交给 Worker)
- app 进程内存放跨请求状态(破坏无状态与水平扩容)
- 数据变更后更新缓存而非删缓存 / 变更后不失效缓存(留脏数据)
- 跨实例读-改-写只靠分布式锁而无行锁兜底(Redis 挂即脏写)
- 事务方法内直接用全局数据库连接而非传入的 `transaction`(该步脱离事务)

---

## 二、前端设计规范

### 技术栈与边界

- Next.js 16 App Router + React 19 + Tailwind CSS 4 + shadcn/base-nova + TanStack Query。
- 前端只访问后端公开 HTTP API，禁止导入 `backend/src`、数据库、Redis 或 Manticore 客户端。
- RBAC 前端显隐只改善体验，不能替代后端 Guard；不得因按钮隐藏而弱化服务端授权。
- 手动 RPC 页面只调用后台 JWT 保护的 `/rpc/debug/*`，导航和页面都按
  `invoke/manual-rpc` 显隐；禁止让浏览器读取、选择或代填 Access Token。
- API、Worker、迁移、种子和前端使用同一 `config.yaml` schema；`CONFIG_FILE` 仅选择文件
  位置，禁止从分散环境变量读取 CORS、管理员、前端 API 地址或其他业务配置值。
- 前端只向浏览器注入 `frontend.apiUrl/apiPort` 白名单；数据库、Redis、JWT 和
  `bootstrap.admin` 不得进入浏览器 HTML。
- Next.js 开发服务器自动允许本机 IPv4 网卡地址访问 HMR；反向代理或自定义开发域名通过
  `frontend.allowedDevOrigins` 显式补充，不允许用全开放通配符绕过开发资源来源检查。

### 数据驱动公共组件

- 能复用的 UI 一律抽到 `components/`,做成**数据驱动**:
  页面只声明**数据**(字段 / 列定义)+ 传 **action**(回调),不在 `page.tsx` 堆大段 JSX。
- 典型基准件：`DataTable`、`PageHeader`、`PermissionBoundary`、`Pagination`、`RowActions`、
  `FormDialog`、`ConfirmDialog`、`SearchInput`、`JsonBlock`、`CopyButton`。
- 新块出现先看 `components/` 有没有现成的,有就复用;**≥2 处重复(或明显可复用原语)才抽,
  单处别过度抽象(YAGNI)。**

### page.tsx 文件拆分

- `page.tsx` **只留页面本身**(页面组件 + 列定义 + return JSX)。
- 对话框 / 行操作 / schema / 展示子组件 / helper 拆到**同级兄弟文件**
  (`xxx-dialogs.tsx` / `xxx-row-actions.tsx` / `xxx-shared.tsx`)——单文件别几百上千行。
- App Router 下,route 目录里非 `page/layout/route` 等特殊名的 `.tsx` 不会成为路由,可安全同级放置。
- 跨页复用的进 `components/`,单页私有的拆到该页同级文件。

### Client 边界

- 纯展示组件不加 `'use client'`;带 hook / handler 的才加。
- 重构保持视觉 / 行为不变(className 结构照旧)。

### 查询与表单

- 小型实体表一次加载后在浏览器执行字段筛选和分页；请求日志、系统日志等大表走服务端筛选和分页。
- 列表默认 10 条/页、最大 100 条/页；分页器作为表格页脚，提供记录区间、数字页码、每页条数与指定页跳转。
- 表格正文和表头使用无衬线字体；仅标识符、令牌、动作和机器时间等技术字段使用等宽字体。
- 筛选项覆盖稳定、短小且有业务意义的表格字段；长载荷、说明、令牌明文和高变化扩展字段不提供筛选。
- 表格长文本必须使用受控列宽、单行省略和 `title` 完整值；窄视口使用表格横向滚动，禁止文本覆盖相邻列。
- 请求详情的 payload/AppAudit 必须按 requestId 懒加载，列表不得携带大字段。
- 请求详情使用右侧抽屉；AppAudit Step 默认收起，由用户按需展开。
- 异步操作不得通过脉冲动画、变长文案或禁用透明度改变造成按钮组闪烁和位移；使用固定文案、
  固定尺寸图标位和 `aria-busy` 表达等待状态，同时继续阻止重复提交。
- 复制令牌或 JSON 时统一使用 `CopyButton` 和 `lib/clipboard.ts`；优先 Clipboard API，
  缺失或权限拒绝时回退到隐藏文本框，不得让页面直接调用
  `navigator.clipboard.writeText`。
- Mutation 成功后只失效相关 TanStack Query key，不全局清空缓存。
- 表单组件只抽通用外壳；项目选择、权限矩阵、AppAudit Step 等特殊控件保留领域组件，
  禁止做充满逃生口的 mega CRUD 配置层。

### 前端命名门禁

- 页面、组件、E2E 与工具脚本执行和后端相同的完整语义命名规则。
- `frontend/test/assert-readable-source.cjs` 扫描 `app/`、`components/`、`lib/`、`e2e/` 和
  `test/`；`pnpm lint` 必须在 ESLint 前通过该门禁。

---

## 三、通用协作约定

- **注释**:放被注释代码的**上一行**(不写行尾),用**中文**。
  ≤2 行用普通 `//`;>2 行用折叠格式——首行概述,明细行前缀 `// >`,更深一层 `// > >`,保证 IDE 可折叠。
  整理存量注释只动注释(位置 / 换行 / 语言),**绝不改代码、逻辑、字符串字面量**。
- **Commit**:emoji + 中文(建议用 commit-msg 钩子强制)。
- **协作流程**:feature 分支 + PR,合并后同步主干、清分支。

---

## 四、测试规范

- `pnpm test` 跑 Jest 单元测试。
- `pnpm test:e2e` 与 `pnpm smoke` 跑同一套完整性黑盒测试；测试进程只允许使用 HTTP 和 WebSocket 公共接口。
- **E2E 绝不直连数据库/Redis/Manticore**，不导入 Nest 应用模块或内部 service，不执行 SQL；Worker 结果必须通过 `/monitor/*`、`/metrics/*` 等公开接口观察。
- `test/assert-blackbox-e2e.js` 是强制边界守卫，新增 E2E 文件必须被它扫描。
- 前端 `test/assert-blackbox-e2e.cjs` 执行同一边界：Playwright 只能操作浏览器和公开 HTTP
  API，不得使用持久层作为测试捷径。
- 必须真实覆盖 WS，不用内存 sink 替代：鉴权、welcome、heartbeat、服务端 ping、读超时、异常帧、RPC job/result、AppAudit、来源身份和去重均走真实 socket。
- 底层维护算法若没有公开控制面，可写 `*.integration.ts` 直接构造 PG/Redis 状态，但命令必须放在 `test:integration:*`，明确标注**非 E2E**。
- 正确流程：启动隔离基础设施 → 迁移和种子 → 启动 API + Worker → 运行 `pnpm smoke`。
- 前端完整流程：统一配置指向同一真实 API/Worker → `CONFIG_FILE=<config> pnpm test:e2e`；
  不允许用数据库造数据后再冒充 E2E。
