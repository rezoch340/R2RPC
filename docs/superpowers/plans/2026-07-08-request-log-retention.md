# request_logs 保留/裁剪 Implementation Plan

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `request_logs` 加自动保留:按天硬清理 + 每 `(group,action,client)` scope 只留最新 N 条,挂在已有的 5min 维护 worker 上,防止日志表无限增长。

**Architecture:** 复用现成的 BullMQ `MAINTENANCE` 队列 + `MaintenanceProcessor` + `WorkerBootstrap`(当前只跑 `repair-stale-pending`)。新增一个同队列的可重复任务 `retention-sweep`(5min),processor 按 `job.name` 分派,调用 `RequestLogsService` 两个新方法:按天 DELETE + 窗口函数 scope 裁剪。清理阈值走集中 YAML 配置(zod 校验)。

**Tech Stack:** NestJS + `@nestjs/bullmq`(BullMQ)、drizzle-orm `node-postgres`、zod 配置、ts-node 冒烟脚本。

## Global Constraints

- 主干开发:绝不直接提交 main,功能分支 → PR → 合并 main。
- 每次提交前:`cd backend && pnpm format && pnpm lint`(eslint 0 error)+ `pnpm build` 通过。
- 中文注释/回答;每阶段更新 `CHANGELOG.md`。
- `request_logs` 是**日志表**:免 `description` 列、免软删除。此处一律**硬 DELETE**,不走 `soft-delete.ts` 的 `alive()`/`softDelete()`。
- 数据源权威在 PG;删除用单条原子语句,不加行锁/分布式锁。

---

## File Structure

- `backend/src/infrastructure/config/config.schema.ts` — 加 `retention` zod 块(rawRetentionDays / keepLatestPerScope)。
- `backend/src/infrastructure/config/config.service.ts` — 加 `get retention()`。
- `backend/config.yaml` — 加 `retention:` 段(可省,zod 有默认;写出来便于运维发现)。
- `backend/src/application/request-logs/request-logs.service.ts` — 加 `cleanupOldRequests(days)` + `trimScopes(keep)`。
- `backend/src/scripts/retention-smoke.ts` — **新建**,独立冒烟(直连 PG,复用真实 service)。
- `backend/package.json` — 加 `retention:smoke` 脚本。
- `backend/src/application/request-logs/worker.bootstrap.ts` — 加 `retention-sweep` 可重复任务。
- `backend/src/application/request-logs/maintenance.processor.ts` — 按 `job.name` 分派 + 注入 `ConfigService`。

**依赖前提(实现前确认,不用改):** `ConfigModule` 是 `@Global`(`DbService` 已跨模块注入 `ConfigService`,证明其全局导出),故 `MaintenanceProcessor` 可直接注入 `ConfigService`。

---

### Task 1: Service 保留/裁剪方法 + 独立冒烟(核心 + TDD)

**Files:**
- Modify: `backend/src/application/request-logs/request-logs.service.ts`(在类内 `findStalePending` 之后追加两个方法)
- Create: `backend/src/scripts/retention-smoke.ts`
- Modify: `backend/package.json`(scripts 加一行)

**Interfaces:**
- Produces:
  - `RequestLogsService.cleanupOldRequests(retentionDays: number): Promise<number>` — 返回删除条数
  - `RequestLogsService.trimScopes(keep: number): Promise<number>` — 返回删除条数

- [ ] **Step 1: 先写冒烟(会失败:方法未定义)**

新建 `backend/src/scripts/retention-smoke.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { RequestLogsService } from '../application/request-logs/request-logs.service';
import { requestLogs } from '../application/request-logs/request-logs.schema';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';

// 保留/裁剪冒烟:直连 PG,种子 -> 跑 cleanupOldRequests/trimScopes -> 断言 -> 清理。
// 前置:PG 已迁移。用法: pnpm retention:smoke
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);
  // 用真实 service,只喂它需要的 { db }(不启 Nest DI)
  const logs = new RequestLogsService({ db } as unknown as DbService);

  const TAG = 'retention-smoke'; // 用 group_name 打标,只碰自己造的数据
  const now = Date.now();

  await db.delete(requestLogs).where(eq(requestLogs.groupName, TAG)); // 清上轮残留

  const rows = [];
  // 2 条超龄(5 天前)-> 预期 cleanup 删掉
  for (let i = 0; i < 2; i++)
    rows.push({
      requestId: `${TAG}-old-${i}`, groupName: TAG, actionName: 'act',
      clientId: 'cli', status: 'ok', createdAt: new Date(now - 5 * 86_400_000),
    });
  // 150 条同 scope 新鲜 -> 预期 trim 后剩 100
  for (let i = 0; i < 150; i++)
    rows.push({
      requestId: `${TAG}-fresh-${i}`, groupName: TAG, actionName: 'act',
      clientId: 'cli', status: 'ok', createdAt: new Date(now - i * 1000),
    });
  await db.insert(requestLogs).values(rows);

  let ok = true;
  const check = (c: boolean, m: string) => {
    console.log((c ? 'PASS' : 'FAIL') + ': ' + m);
    if (!c) ok = false;
  };

  const cleaned = await logs.cleanupOldRequests(3);
  check(cleaned === 2, `cleanup 删 2 条超龄(实际 ${cleaned})`);

  const trimmed = await logs.trimScopes(100);
  check(trimmed === 50, `trim 裁 50 条 = 150-100(实际 ${trimmed})`);

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(requestLogs)
    .where(eq(requestLogs.groupName, TAG));
  check(n === 100, `scope 最终剩 100 条(实际 ${n})`);

  await db.delete(requestLogs).where(eq(requestLogs.groupName, TAG)); // 清理种子
  await pool.end();
  console.log(ok ? '\n=== RETENTION SMOKE PASSED ===' : '\n=== RETENTION SMOKE FAILED ===');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

在 `backend/package.json` 的 `scripts` 里加(紧挨 `smoke` 那行):

```json
"retention:smoke": "ts-node -r tsconfig-paths/register src/scripts/retention-smoke.ts",
```

- [ ] **Step 2: 跑冒烟确认失败**

Run: `cd backend && pnpm retention:smoke`
Expected: 编译/运行报错 —`logs.cleanupOldRequests is not a function`(方法还没实现)。

- [ ] **Step 3: 实现两个方法**

在 `backend/src/application/request-logs/request-logs.service.ts` 类内 `findStalePending(...)` 之后追加(`lt`、`sql`、`requestLogs` 均已 import,无需新增):

```ts
  // 按天硬清理:删 created_at 早于 retentionDays 天的日志(log 表不软删)。返回删除条数。
  async cleanupOldRequests(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const res = await this.db
      .delete(requestLogs)
      .where(lt(requestLogs.createdAt, cutoff));
    return res.rowCount ?? 0;
  }

  // 按 scope 裁剪:每 (group,action,client) 只留最新 keep 条(created_at DESC, id DESC)。返回删除条数。
  // client_id 为 NULL 的行归为同一 scope("无 client")。
  // ponytail: 全表窗口扫描,每轮维护跑一次;量级大到扛不住再改成只裁剪近期活跃 scope。
  async trimScopes(keep: number): Promise<number> {
    const res = await this.db.execute(sql`
      DELETE FROM ${requestLogs}
      WHERE ${requestLogs.id} IN (
        SELECT id FROM (
          SELECT ${requestLogs.id} AS id, ROW_NUMBER() OVER (
            PARTITION BY ${requestLogs.groupName}, ${requestLogs.actionName}, ${requestLogs.clientId}
            ORDER BY ${requestLogs.createdAt} DESC, ${requestLogs.id} DESC
          ) AS rn
          FROM ${requestLogs}
        ) ranked
        WHERE rn > ${keep}
      )
    `);
    return res.rowCount ?? 0;
  }
```

- [ ] **Step 4: 跑冒烟确认通过**

Run: `cd backend && pnpm retention:smoke`
Expected: 三条 PASS + `=== RETENTION SMOKE PASSED ===`,退出码 0。

- [ ] **Step 5: 提交**

```bash
cd backend && pnpm format && pnpm lint && pnpm build
git add backend/src/application/request-logs/request-logs.service.ts backend/src/scripts/retention-smoke.ts backend/package.json
git commit -m "🧹 request_logs 保留/裁剪:cleanupOldRequests + trimScopes + 独立冒烟"
```

---

### Task 2: retention 集中配置

**Files:**
- Modify: `backend/src/infrastructure/config/config.schema.ts`
- Modify: `backend/src/infrastructure/config/config.service.ts`
- Modify: `backend/config.yaml`

**Interfaces:**
- Consumes: 无
- Produces: `ConfigService.retention: { rawRetentionDays: number; keepLatestPerScope: number }`

- [ ] **Step 1: zod schema 加 retention 块**

在 `config.schema.ts` 的 `configSchema` 对象内(`manticore` 之后)加:

```ts
  retention: z
    .object({
      rawRetentionDays: z.number().int().positive().default(3),
      keepLatestPerScope: z.number().int().positive().default(100),
    })
    .default({}),
```

> 老系统是 `≤0 → 默认`;本仓库约定"校验失败即启动失败",故用 `.positive()` 让非法值直接报错终止,而不是静默兜底。

- [ ] **Step 2: config.service 加 getter**

在 `config.service.ts` 的 `get manticore()` 之后加:

```ts
  get retention() {
    return this.all.retention;
  }
```

- [ ] **Step 3: config.yaml 写出默认(可选段,便于运维发现)**

在 `backend/config.yaml` 末尾加:

```yaml
# 日志保留(request_logs 是 log 表,硬删)
retention:
  rawRetentionDays: 3     # 删超过 N 天的请求日志
  keepLatestPerScope: 100 # 每 (group,action,client) 只留最新 N 条
```

- [ ] **Step 4: 确认配置加载不报错**

Run: `cd backend && pnpm build && node -e "const {ConfigService}=require('./dist/infrastructure/config/config.service'); const c=new ConfigService(); console.log(JSON.stringify(c.retention))"`
Expected: 打印 `{"rawRetentionDays":3,"keepLatestPerScope":100}`,无校验错误。

- [ ] **Step 5: 提交**

```bash
cd backend && pnpm format && pnpm lint
git add backend/src/infrastructure/config/config.schema.ts backend/src/infrastructure/config/config.service.ts backend/config.yaml
git commit -m "⚙️ retention 配置:rawRetentionDays/keepLatestPerScope(zod 校验)"
```

---

### Task 3: 挂到维护 worker(retention-sweep 5min)

**Files:**
- Modify: `backend/src/application/request-logs/worker.bootstrap.ts`
- Modify: `backend/src/application/request-logs/maintenance.processor.ts`

**Interfaces:**
- Consumes: Task 1 的 `cleanupOldRequests`/`trimScopes`;Task 2 的 `ConfigService.retention`

- [ ] **Step 1: bootstrap 加 retention-sweep 可重复任务**

在 `worker.bootstrap.ts` 的 `onModuleInit` 内、现有 `repair-stale-pending` 的 `add(...)` 之后追加:

```ts
    await this.maintenance.add(
      'retention-sweep',
      {},
      {
        repeat: { every: 5 * 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
```

- [ ] **Step 2: processor 注入 ConfigService + 按 job.name 分派**

改 `maintenance.processor.ts`:构造函数注入 `ConfigService`,`process` 按名分派,抽出两段私有方法。整文件改为:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE } from '../../infrastructure/queue/queue.constants';
import { ConfigService } from '../../infrastructure/config/config.service';
import { RequestLogsService } from './request-logs.service';

const STALE_PENDING_MS = 10 * 60 * 1000;

// 定时维护:① repair 陈旧 pending;② request_logs 保留/裁剪。按 job.name 分派。
@Processor(QUEUE.MAINTENANCE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger('MaintenanceProcessor');

  constructor(
    private readonly logs: RequestLogsService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'repair-stale-pending') return this.repairStalePending();
    if (job.name === 'retention-sweep') return this.retentionSweep();
  }

  // 扫描 worker 崩溃遗留的陈旧 pending,标 unavailable(payload 已无从补)
  private async repairStalePending() {
    const stale = await this.logs.findStalePending(STALE_PENDING_MS, 500);
    for (const r of stale) {
      await this.logs.markState(r.requestId, 'unavailable');
    }
    if (stale.length) {
      this.logger.warn(`repair:${stale.length} 条陈旧 pending 标记为 unavailable`);
    }
    return { marked: stale.length };
  }

  // 按天清理 + 按 scope 裁剪 request_logs
  private async retentionSweep() {
    const { rawRetentionDays, keepLatestPerScope } = this.config.retention;
    const cleaned = await this.logs.cleanupOldRequests(rawRetentionDays);
    const trimmed = await this.logs.trimScopes(keepLatestPerScope);
    if (cleaned || trimmed) {
      this.logger.log(
        `retention: 清理 ${cleaned} 条(>${rawRetentionDays}天), 裁剪 ${trimmed} 条(每scope>${keepLatestPerScope})`,
      );
    }
    return { cleaned, trimmed };
  }
}
```

- [ ] **Step 3: build 通过**

Run: `cd backend && pnpm build`
Expected: 编译 0 error(尤其确认 `ConfigService` 注入解析成功)。

- [ ] **Step 4: worker 起来手动验证(前置:基础设施 + 迁移就绪)**

Run: `cd backend && pnpm start:worker`
先造超龄数据(另开终端):`pnpm retention:smoke` 只验方法;要验 worker 定时,把 `retention-sweep` 的 `repeat.every` 临时改 `5000`(5s)本地跑,观察日志出现 `retention: ...` 行后**改回** `5 * 60 * 1000`。
Expected: worker 日志按周期打印 retention 汇总行(无数据时不打印,属正常)。

> ponytail: 不为"手动改间隔"再加一个 env 开关——本地临时验证够用,验完改回。

- [ ] **Step 5: 提交 + 更新 CHANGELOG**

在 `CHANGELOG.md` 顶部加一条(照现有条目格式):`request_logs 自动保留:按天清理(默认3天)+ 每 scope 留最新100条,挂 5min 维护 worker`。

```bash
cd backend && pnpm format && pnpm lint
git add backend/src/application/request-logs/worker.bootstrap.ts backend/src/application/request-logs/maintenance.processor.ts CHANGELOG.md
git commit -m "⏱️ retention-sweep 挂 5min 维护 worker(按天清理 + scope 裁剪)"
```

---

## Out of Scope(本 plan 不做)

- **聚合表按天清理**(§2.8 item 3,`AGGREGATE_RETENTION_DAYS`):`device_daily`/`rpc_daily` 表尚不存在,归入待办 #3 指标聚合体系一起做。
- 分批删除 / LIMIT 削峰:单条原子 DELETE 够用,量级压不住再上(已在 `trimScopes` 注释标了升级路径)。
- 维护间隔可配置化:固定 5min(与老系统一致),YAGNI。

## Self-Review

- **Spec coverage(§2.8):** item 1 按天清理 → Task 1 `cleanupOldRequests` ✅;item 2 按 scope 裁剪 → Task 1 `trimScopes` ✅;item 3 聚合清理 → 显式 Out of Scope(表不存在)✅。触发方式 5min 维护 → Task 3 ✅。默认值 3/100 → Task 2 ✅。
- **Placeholder scan:** 无 TBD / "适当处理" / 空测试;每个改代码的 step 都有完整代码。✅
- **Type consistency:** `cleanupOldRequests`/`trimScopes` 签名在 Task 1 定义,Task 3 processor 与冒烟脚本调用一致(参数 number,返回 Promise<number>);`ConfigService.retention` 字段名 `rawRetentionDays`/`keepLatestPerScope` 在 Task 2 定义、Task 3 解构一致。✅
- **驱动假设:** `db.delete().where()` 与 `db.execute(sql\`\`)` 在 node-postgres 下返回带 `.rowCount` 的 pg 结果 → 实现时若类型上 `rowCount` 需断言,用 `res.rowCount ?? 0` 已兜住 null。实现 step 4 的冒烟断言即为该假设的运行时校验。
