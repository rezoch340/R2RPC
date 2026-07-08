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

写库方法**接收一个可选的事务句柄** `tx`:**传了就加入调用方的事务,没传就自己开一个新事务**。
这样多个写方法嵌套调用能合进**一个事务**(要么全成要么全滚),单独调用又能独立跑。

```ts
// 事务句柄类型:从 db.transaction 回调参数推导,免得手写冗长泛型
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async fillAndSave(params: { /* … */ tx?: Tx }) {
  const run = async (tx: Tx) => {
    // 所有写操作都走这个 tx:tx.insert(...).values(...) / tx.update(...)…
    // …
    return result;
  };
  // 传了句柄 → 复用调用方事务;没传 → 开新事务
  return params.tx ? run(params.tx) : this.db.transaction(run);
}
```

- **关键纪律**:`run` 里所有写操作一律走参数里的 `tx`,**绝不**直接用全局 `this.db`——
  否则那步脱离事务,回滚时漏掉、破坏原子性。
- 下游 service 也照此签名(`tx?` 一路往下透传),整条调用链共用同一个事务。
- **Drizzle 支持 savepoint 真嵌套**:`tx.transaction(...)` 可开子事务、回滚到中间点(Prisma 做不到)。
- 嫌到处透传 `tx` 烦?用 `@nestjs-cls/transactional-adapter-drizzle-orm`(AsyncLocalStorage 环境事务)
  自动传播,service 不用再手接 `tx?` 参数。

### 缓存:cache-aside + 写即失效

统一 **cache-aside(旁路缓存)+ 写即失效**,杜绝脏数据:

- **读**:先查缓存,命中即返回;**未命中读库,回填缓存**再返回(设 TTL 兜底)。
- **写 / 改 / 删**:先落库(权威源),**再删除**对应缓存 key(**失效,不是更新**),下次读自然回填最新值。
- **删而不更新**:直接更新缓存在并发下有「写覆盖」竞态、易留脏值;删除最简单、最不易脏。
- **顺序**:先写库、后删缓存;删缓存失败要重试(否则残留脏值)。

### 请求日志(取证脊柱 + 全文镜像)

请求日志一条数据**分两处存,各司其职**:

| 存储 | 存什么 | 角色 |
|---|---|---|
| **关系库(PostgreSQL)** | **取证脊柱**:标量列(`id / type / method / route / statusCode / latencyMs / createdAt`)+ 标识列(如 `projectId / tokenId / appCode`) | 权威、可按标量/标识过滤;**不含原始 payload JSON** |
| **全文库(Manticore / ES 类)** | 上述列 + **完整原始 payload(JSON)** | 全文搜索 + 原始 payload 存储 |

- **为什么不把 payload 塞进关系库**:请求日志是高频 append 表,`requestBody/Headers/responseBody`
  可以很大,直接灌进关系库会撑爆、拖慢。原始 payload 只落全文库,关系库只留可查的脊柱。
- **两边共用 `id`**:worker 先写关系库拿 `id`,再当全文库文档的 `logid`,取证时互查。
- **写入异步化**:请求热路径只入队(队列),写库在 worker 里做;全文库失败不影响主请求,重试耗尽进死信队列。
- **读取走全文库镜像**:列表**不返 payload**(轻量);详情按 `logid` **懒加载**单条原始 payload。

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
- 事务方法内直接用全局 `db` / 连接而非传入的 `tx`(该步脱离事务)

---

## 二、前端设计规范

### 数据驱动公共组件

- 能复用的 UI 一律抽到 `components/`,做成**数据驱动**:
  页面只声明**数据**(字段 / 列定义)+ 传 **action**(回调),不在 `page.tsx` 堆大段 JSX。
- 典型基准件:`FilterBar`、`DataTable`(columns 可设 `meta.align: 'left' | 'center' | 'right'`,
  actions 列用 `align:'right'`)、`PageHeader`、`NoPermission`、`Pager`、`RowActions`。
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

---

## 三、通用协作约定

- **注释**:放被注释代码的**上一行**(不写行尾),用**中文**。
  ≤2 行用普通 `//`;>2 行用折叠格式——首行概述,明细行前缀 `// >`,更深一层 `// > >`,保证 IDE 可折叠。
  整理存量注释只动注释(位置 / 换行 / 语言),**绝不改代码、逻辑、字符串字面量**。
- **Commit**:emoji + 中文(建议用 commit-msg 钩子强制)。
- **协作流程**:feature 分支 + PR,合并后同步主干、清分支。

---

## 四、测试规范

- 测试跑 **Jest**(`pnpm test` / `pnpm test:e2e`,NestJS CLI 默认自带)。
- **e2e 绝不直连数据库**——所有校验都通过 HTTP API 打(禁一次性直连库的 verify 脚本),
  断言走响应或内存 sink 捕获。
- 正确流程:**改完先 build 进容器 → 对运行中的容器跑 e2e / 灌数据**。
