# 3a: 指标聚合管道(日聚合表 + 完成累加 + 重启对账 + 清理)实现计划

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)。

**Goal:** 建两张日聚合表(`device_daily_metrics`/`rpc_daily_metrics`,对齐老系统)+ 每次 RPC 完成时累加(挂 `RequestLogProcessor`,靠 `writeSpine` 首插判去重)+ worker 启动从 `request_logs` 重灌最近 N 天对账 + 聚合表按天清理(30 天)。**只做写入管道 + 对账 + 清理**;读侧派生视图(weekly/trend/overview)是 3b。

**Architecture:** 增量累加(热,per-completion upsert,exactly-once via writeSpine 首插判)+ 对账兜底(冷,worker 启动重灌修漂移)。状态归类新系统口径:`ok`→success、`timeout`→timeout、其余→failed。日期按 **UTC** 分桶(增量 ISO 前 10 位;对账 `(created_at AT TIME ZONE 'UTC')::date`),保证增量与对账同口径。聚合表是**派生/日志型**(可从 request_logs 重建 + 硬清理)→ **不加 description/deleted_at**(同 request_logs 豁免,见 [[soft-delete-non-log-entities]] 的日志表例外)。

**Tech Stack:** NestJS 11 · drizzle-orm 0.45(`date`/`bigint`/`onConflictDoUpdate`/`sql` 增量)· BullMQ · zod config。

## Global Constraints

- **不直接提交 main。** 已在分支 `feat/3-metrics-aggregation`。功能分支 → PR → 合并。
- **提交/PR 前**(从 `backend/` 跑,**不用 `pnpm <script>`**——包装器跑失败的 `pnpm install`;直接 `node_modules/.bin/{nest build,eslint,prettier,drizzle-kit,ts-node}`):`nest build`(0)+ eslint + prettier。
- **破坏式迁移已批**:drop 没用的 `metrics` 空壳表 + 建两张日聚合表(增量 ADD/DROP,非交互)。
- **聚合表豁免实体表铁律**(派生/日志型,硬清理):**无 description、无 deleted_at**,复合 PK,读不过滤 alive。
- **对账/清理无 API 面** → 直连 PG 冒烟(mirror `retention-smoke`,[[api-vs-pg-boundary]] 允许)。
- **去重正确性**:增量累加不幂等,`RequestLogProcessor` 会重试(attempts:3)→ `writeSpine` 返回"是否首插",**仅首插才 recordCompletion**;对账兜底修任何漂移。

---

## File Structure

- **改** `src/application/metrics/metrics.schema.ts` — 删 `metrics` 空壳,建 `deviceDailyMetrics` + `rpcDailyMetrics`。
- **改** `src/application/metrics/metrics.service.ts` — 加 `recordCompletion`/`rebuildRecent`/`cleanupOldMetrics`(读侧 overview 暂留,3b 改)。
- **改** `src/application/metrics/metrics.module.ts` — exports MetricsService。
- **改** `src/application/request-logs/request-logs.service.ts` — `writeSpine` 返回 boolean(是否首插)。
- **改** `src/application/request-logs/request-log.processor.ts` — 注入 MetricsService,首插后 recordCompletion。
- **改** `src/application/request-logs/worker.bootstrap.ts` — 启动对账 + 排 `metrics-cleanup` 定时。
- **改** `src/application/request-logs/maintenance.processor.ts` — dispatch `metrics-cleanup`。
- **改** `src/worker.module.ts` — imports 加 MetricsModule。
- **改** `src/infrastructure/config/config.schema.ts` + `config.service.ts` — retention 加 `aggregateRetentionDays`(30)。
- **新** `src/scripts/metrics-smoke.ts` + `package.json` 脚本。
- **新迁移** `0004_*.sql`。

---

## Task 1: 两张日聚合表 + config + 迁移

**Files:** Modify `metrics.schema.ts`, `config.schema.ts`, `config.service.ts`;Generate `drizzle/0004_*.sql`。

- [ ] **Step 1: metrics.schema.ts 换成两张日聚合表**(全文替换)

```ts
import {
  bigint,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

// 设备日聚合(对齐老系统 device_daily_metrics)。派生/日志型:无 description/deleted_at,硬清理。
export const deviceDailyMetrics = pgTable(
  'device_daily_metrics',
  {
    statDate: date('stat_date').notNull(),
    clientId: varchar('client_id', { length: 128 }).notNull(),
    projectName: varchar('project_name', { length: 128 }).notNull(),
    totalRequests: bigint('total_requests', { mode: 'number' }).notNull().default(0),
    successRequests: bigint('success_requests', { mode: 'number' }).notNull().default(0),
    failedRequests: bigint('failed_requests', { mode: 'number' }).notNull().default(0),
    timeoutRequests: bigint('timeout_requests', { mode: 'number' }).notNull().default(0),
    totalLatencyMs: bigint('total_latency_ms', { mode: 'number' }).notNull().default(0),
    maxLatencyMs: integer('max_latency_ms').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.statDate, t.clientId, t.projectName] }),
    index('device_daily_project_date').on(t.projectName, t.statDate),
    index('device_daily_client_date').on(t.clientId, t.statDate),
  ],
);

// RPC 日聚合(对齐老系统 rpc_daily_metrics)。client_id 用 '' 表示无设备(不用 NULL,进复合 PK)。
export const rpcDailyMetrics = pgTable(
  'rpc_daily_metrics',
  {
    statDate: date('stat_date').notNull(),
    projectName: varchar('project_name', { length: 128 }).notNull(),
    actionName: varchar('action_name', { length: 128 }).notNull(),
    clientId: varchar('client_id', { length: 128 }).notNull().default(''),
    totalRequests: bigint('total_requests', { mode: 'number' }).notNull().default(0),
    successRequests: bigint('success_requests', { mode: 'number' }).notNull().default(0),
    failedRequests: bigint('failed_requests', { mode: 'number' }).notNull().default(0),
    timeoutRequests: bigint('timeout_requests', { mode: 'number' }).notNull().default(0),
    totalLatencyMs: bigint('total_latency_ms', { mode: 'number' }).notNull().default(0),
    maxLatencyMs: integer('max_latency_ms').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.statDate, t.projectName, t.actionName, t.clientId] }),
    index('rpc_daily_project_date').on(t.projectName, t.statDate),
    index('rpc_daily_action_date').on(t.actionName, t.statDate),
  ],
);
```
> 执行前 grep 确认没有别处 import 老的 `metrics` const:`grep -rn "from '.*metrics/metrics.schema'" src`(应只有本文件的旧引用被删)。

- [ ] **Step 2: config 加 aggregateRetentionDays**

`config.schema.ts` 的 `retention` object 里加一行(在 `keepLatestPerScope` 之后):
```ts
    keepLatestPerScope: z.number().int().positive().default(100),
    aggregateRetentionDays: z.number().int().positive().default(30),
```
`config.service.ts` 的 `get retention()` 已返回整个 retention 对象,无需改。

- [ ] **Step 3: 生成 + 应用迁移 + reseed**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend
node_modules/.bin/drizzle-kit generate
grep -nE 'CREATE TABLE "(device_daily_metrics|rpc_daily_metrics)"|DROP TABLE "metrics"' drizzle/0004_*.sql
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/migrate.ts
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts
node_modules/.bin/drizzle-kit generate
```
Expected:两张 CREATE TABLE + DROP TABLE "metrics";无交互;`迁移完成`;seed 无报错;末次 generate `No schema changes`。

- [ ] **Step 4: build + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -3
cd /Users/lpitiless/Documents/R2RPC && git add backend/src/application/metrics/metrics.schema.ts backend/src/infrastructure/config backend/drizzle && git commit -m "feat(3a): device_daily_metrics + rpc_daily_metrics tables (drop metrics shell) + aggregateRetentionDays config + migration"
```

---

## Task 2: 完成累加(recordCompletion)+ writeSpine 首插判 + 挂 RequestLogProcessor

**Files:** Modify `metrics.service.ts`, `metrics.module.ts`, `request-logs.service.ts`, `request-log.processor.ts`, `worker.module.ts`。

**Interfaces:**
- Produces:`MetricsService.recordCompletion(job: RequestLogJob): Promise<void>`;`RequestLogsService.writeSpine(...): Promise<boolean>`(是否首插)。

- [ ] **Step 1: writeSpine 返回是否首插**

`request-logs.service.ts` 的 `writeSpine` 改成返回 boolean(用 pg `rowCount`):
```ts
  async writeSpine(job: RequestLogJob, payloadState: PayloadState): Promise<boolean> {
    const res = await this.db
      .insert(requestLogs)
      .values({
        // ...(现有 values 不变)...
      })
      .onConflictDoNothing({ target: requestLogs.requestId });
    return (res.rowCount ?? 0) > 0; // true = 本次真的插了(首见 requestId)
  }
```
> 只加 `const res =` 承接 + `return`;values 体不动。现有忽略返回值的调用方(rpc.service 降级路径)不受影响。

- [ ] **Step 2: MetricsService 加 recordCompletion**(在类内加,import 顶部补)

顶部加 import:
```ts
import { RequestLogJob } from '../request-logs/request-log.types';
import { deviceDailyMetrics, rpcDailyMetrics } from './metrics.schema';
```
类内加(`sql`/`eq` 等按需 import;`sql` 已在用):
```ts
  // 状态归类:ok→success,timeout→timeout,其余→failed(新系统 status 口径)
  private classify(status: string) {
    return {
      success: status === 'ok' ? 1 : 0,
      timeout: status === 'timeout' ? 1 : 0,
      failed: status !== 'ok' && status !== 'timeout' ? 1 : 0,
    };
  }

  // 单次 RPC 完成累加(热路径,per-completion upsert)。仅 RequestLogProcessor 首插时调,保证 exactly-once。
  async recordCompletion(job: RequestLogJob): Promise<void> {
    const statDate = job.createdAt.slice(0, 10); // ISO(UTC)前 10 位 = UTC 日期
    const { success, timeout, failed } = this.classify(job.status);
    const latency = job.latencyMs ?? 0;
    const clientId = job.clientId ?? '';

    await this.db
      .insert(rpcDailyMetrics)
      .values({
        statDate,
        projectName: job.project,
        actionName: job.action,
        clientId,
        totalRequests: 1,
        successRequests: success,
        failedRequests: failed,
        timeoutRequests: timeout,
        totalLatencyMs: latency,
        maxLatencyMs: latency,
      })
      .onConflictDoUpdate({
        target: [
          rpcDailyMetrics.statDate,
          rpcDailyMetrics.projectName,
          rpcDailyMetrics.actionName,
          rpcDailyMetrics.clientId,
        ],
        set: {
          totalRequests: sql`${rpcDailyMetrics.totalRequests} + 1`,
          successRequests: sql`${rpcDailyMetrics.successRequests} + ${success}`,
          failedRequests: sql`${rpcDailyMetrics.failedRequests} + ${failed}`,
          timeoutRequests: sql`${rpcDailyMetrics.timeoutRequests} + ${timeout}`,
          totalLatencyMs: sql`${rpcDailyMetrics.totalLatencyMs} + ${latency}`,
          maxLatencyMs: sql`GREATEST(${rpcDailyMetrics.maxLatencyMs}, ${latency})`,
          updatedAt: new Date(),
        },
      });

    // device 维度只在有真实 client 时累加(无 client 不进 device_daily)
    if (job.clientId) {
      await this.db
        .insert(deviceDailyMetrics)
        .values({
          statDate,
          clientId: job.clientId,
          projectName: job.project,
          totalRequests: 1,
          successRequests: success,
          failedRequests: failed,
          timeoutRequests: timeout,
          totalLatencyMs: latency,
          maxLatencyMs: latency,
        })
        .onConflictDoUpdate({
          target: [
            deviceDailyMetrics.statDate,
            deviceDailyMetrics.clientId,
            deviceDailyMetrics.projectName,
          ],
          set: {
            totalRequests: sql`${deviceDailyMetrics.totalRequests} + 1`,
            successRequests: sql`${deviceDailyMetrics.successRequests} + ${success}`,
            failedRequests: sql`${deviceDailyMetrics.failedRequests} + ${failed}`,
            timeoutRequests: sql`${deviceDailyMetrics.timeoutRequests} + ${timeout}`,
            totalLatencyMs: sql`${deviceDailyMetrics.totalLatencyMs} + ${latency}`,
            maxLatencyMs: sql`GREATEST(${deviceDailyMetrics.maxLatencyMs}, ${latency})`,
            updatedAt: new Date(),
          },
        });
    }
  }
```

- [ ] **Step 3: MetricsModule exports MetricsService**

`metrics.module.ts` 的 `@Module` 加 `exports: [MetricsService]`(providers 里已有 MetricsService)。

- [ ] **Step 4: RequestLogProcessor 首插后累加**

import + 构造函数注入 `MetricsService`:
```ts
import { MetricsService } from '../metrics/metrics.service';
```
```ts
  constructor(
    private readonly logs: RequestLogsService,
    private readonly search: SearchService,
    private readonly metrics: MetricsService,
    @InjectQueue(QUEUE.DEAD_LETTER) private readonly dlq: Queue,
  ) {
    super();
  }
```
`process` 改成(先写脊柱 → 首插才累加 → 再 Manticore/标态,把累加放 flaky Manticore 前):
```ts
  async process(job: Job<RequestLogJob>) {
    const d = job.data;
    const fresh = await this.logs.writeSpine(d, 'pending');
    if (fresh) await this.metrics.recordCompletion(d); // 仅首见 requestId 累加(去重;重试不重复计)
    await this.search.indexPayload(buildManticoreDoc(d));
    await this.logs.markState(d.requestId, 'indexed');
  }
```

- [ ] **Step 5: WorkerModule import MetricsModule**

`worker.module.ts` 的 `imports` 加 `MetricsModule`(从 `./application/metrics/metrics.module`)。

- [ ] **Step 6: build + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -6
cd /Users/lpitiless/Documents/R2RPC && git add backend/src && git commit -m "feat(3a): recordCompletion daily aggregation on RequestLogProcessor first-insert (dedup via writeSpine)"
```

---

## Task 3: 重启对账(rebuildRecent)+ 按天清理(cleanupOldMetrics)+ worker 接线

**Files:** Modify `metrics.service.ts`, `worker.bootstrap.ts`, `maintenance.processor.ts`。

- [ ] **Step 1: MetricsService 加 rebuildRecent + cleanupOldMetrics**

顶部 import 补 `gte`/`lt`(从 drizzle-orm):`import { gte, lt, sql } from 'drizzle-orm';`(与现有合并)。类内加:
```ts
  // 重启对账:删最近 days 天聚合行 -> 从 request_logs 重聚合(修增量丢/重)。UTC 分桶,同 recordCompletion 口径。
  async rebuildRecent(days: number): Promise<void> {
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    await this.db.transaction(async (tx) => {
      await tx.delete(rpcDailyMetrics).where(gte(rpcDailyMetrics.statDate, cutoffDate));
      await tx.delete(deviceDailyMetrics).where(gte(deviceDailyMetrics.statDate, cutoffDate));
      await tx.execute(sql`
        INSERT INTO rpc_daily_metrics
          (stat_date, project_name, action_name, client_id,
           total_requests, success_requests, failed_requests, timeout_requests,
           total_latency_ms, max_latency_ms, updated_at)
        SELECT (created_at AT TIME ZONE 'UTC')::date, project_name, action_name, COALESCE(client_id, ''),
          count(*),
          count(*) FILTER (WHERE status = 'ok'),
          count(*) FILTER (WHERE status <> 'ok' AND status <> 'timeout'),
          count(*) FILTER (WHERE status = 'timeout'),
          COALESCE(sum(latency_ms), 0), COALESCE(max(latency_ms), 0), now()
        FROM request_logs
        WHERE created_at >= ${cutoff}
        GROUP BY 1, project_name, action_name, COALESCE(client_id, '')
      `);
      await tx.execute(sql`
        INSERT INTO device_daily_metrics
          (stat_date, client_id, project_name,
           total_requests, success_requests, failed_requests, timeout_requests,
           total_latency_ms, max_latency_ms, updated_at)
        SELECT (created_at AT TIME ZONE 'UTC')::date, client_id, project_name,
          count(*),
          count(*) FILTER (WHERE status = 'ok'),
          count(*) FILTER (WHERE status <> 'ok' AND status <> 'timeout'),
          count(*) FILTER (WHERE status = 'timeout'),
          COALESCE(sum(latency_ms), 0), COALESCE(max(latency_ms), 0), now()
        FROM request_logs
        WHERE created_at >= ${cutoff} AND client_id IS NOT NULL
        GROUP BY 1, client_id, project_name
      `);
    });
  }

  // 按天清理:删 stat_date 早于 今天-(retentionDays-1) 的聚合行。返回删除条数。
  async cleanupOldMetrics(retentionDays: number): Promise<{ rpc: number; device: number }> {
    const cutoff = new Date(Date.now() - (retentionDays - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const r = await this.db.delete(rpcDailyMetrics).where(lt(rpcDailyMetrics.statDate, cutoff));
    const d = await this.db.delete(deviceDailyMetrics).where(lt(deviceDailyMetrics.statDate, cutoff));
    return { rpc: r.rowCount ?? 0, device: d.rowCount ?? 0 };
  }
```

- [ ] **Step 2: WorkerBootstrap 启动对账 + 排 metrics-cleanup 定时**

注入 `MetricsService` + `ConfigService`:
```ts
import { MetricsService } from '../metrics/metrics.service';
import { ConfigService } from '../../infrastructure/config/config.service';
```
```ts
  constructor(
    @InjectQueue(QUEUE.MAINTENANCE) private readonly maintenance: Queue,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}
```
`onModuleInit` 里:开头加启动对账(最近 rawRetentionDays 天),末尾加 metrics-cleanup 定时:
```ts
  async onModuleInit() {
    // worker 启动即对账最近 N 天,修正增量累加的丢/重
    await this.metrics
      .rebuildRecent(this.config.retention.rawRetentionDays)
      .catch(() => undefined);
    // ...(现有 repair-stale-pending / retention-sweep / mark-devices-stale 三个 add 不变)...
    await this.maintenance.add(
      'metrics-cleanup',
      {},
      { repeat: { every: 5 * 60 * 1000 }, removeOnComplete: true, removeOnFail: true },
    );
  }
```

- [ ] **Step 3: MaintenanceProcessor dispatch metrics-cleanup**

注入 `MetricsService`(构造函数加),`process` 加分派 + 私有方法:
```ts
import { MetricsService } from '../metrics/metrics.service';
```
```ts
    if (job.name === 'metrics-cleanup') return this.metricsCleanup();
```
```ts
  private async metricsCleanup() {
    const { aggregateRetentionDays } = this.config.retention;
    const { rpc, device } = await this.metrics.cleanupOldMetrics(aggregateRetentionDays);
    if (rpc || device)
      this.logger.log(`metrics-cleanup: 删聚合 rpc ${rpc} + device ${device}(>${aggregateRetentionDays}天)`);
    return { rpc, device };
  }
```

- [ ] **Step 4: build + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -6
cd /Users/lpitiless/Documents/R2RPC && git add backend/src && git commit -m "feat(3a): startup reconcile from request_logs + daily aggregate-table cleanup worker"
```

---

## Task 4: 聚合管道直连冒烟(无 API 面)

**Files:** Create `src/scripts/metrics-smoke.ts`;Modify `package.json`。

- [ ] **Step 1: 建 `src/scripts/metrics-smoke.ts`**

```ts
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MetricsService } from '../application/metrics/metrics.service';
import {
  deviceDailyMetrics,
  rpcDailyMetrics,
} from '../application/metrics/metrics.schema';
import { requestLogs } from '../application/request-logs/request-logs.schema';
import { RequestLogJob } from '../application/request-logs/request-log.types';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';

// 聚合管道冒烟(无 API 面 → 直连 PG):① recordCompletion 累加;② rebuildRecent 从 request_logs 重灌。
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);
  const svc = new MetricsService({ db } as unknown as DbService);

  const PROJ = 'metrics-smoke-proj';
  const ACT = 'act';
  const CID = 'metrics-smoke-dev';
  const DAY = new Date().toISOString().slice(0, 10);
  const clean = async () => {
    await db.delete(rpcDailyMetrics).where(eq(rpcDailyMetrics.projectName, PROJ));
    await db.delete(deviceDailyMetrics).where(eq(deviceDailyMetrics.projectName, PROJ));
    await db.delete(requestLogs).where(eq(requestLogs.projectName, PROJ));
  };
  await clean();

  let ok = true;
  const check = (c: boolean, m: string) => {
    console.log((c ? 'PASS' : 'FAIL') + ': ' + m);
    if (!c) ok = false;
  };
  const job = (status: string, latency: number): RequestLogJob => ({
    requestId: `ms-${Math.round(latency)}-${status}`,
    project: PROJ,
    action: ACT,
    clientId: CID,
    requesterUserId: null,
    accessTokenId: null,
    status,
    httpCode: 200,
    latencyMs: latency,
    error: null,
    requestPayload: null,
    responsePayload: null,
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });

  // ① 累加:3 ok + 1 timeout + 1 error,延迟 10/20/30/40/50
  await svc.recordCompletion(job('ok', 10));
  await svc.recordCompletion(job('ok', 20));
  await svc.recordCompletion(job('ok', 30));
  await svc.recordCompletion(job('timeout', 40));
  await svc.recordCompletion(job('error', 50));

  const [r] = await db
    .select()
    .from(rpcDailyMetrics)
    .where(
      and(
        eq(rpcDailyMetrics.projectName, PROJ),
        eq(rpcDailyMetrics.clientId, CID),
      ),
    );
  check(!!r, 'rpc_daily 有累加行');
  check(r?.totalRequests === 5, `total=5(实际 ${r?.totalRequests})`);
  check(r?.successRequests === 3, `success=3(实际 ${r?.successRequests})`);
  check(r?.timeoutRequests === 1, `timeout=1(实际 ${r?.timeoutRequests})`);
  check(r?.failedRequests === 1, `failed=1(error 归 failed,实际 ${r?.failedRequests})`);
  check(Number(r?.totalLatencyMs) === 150, `total_latency=150(实际 ${r?.totalLatencyMs})`);
  check(r?.maxLatencyMs === 50, `max_latency=50(实际 ${r?.maxLatencyMs})`);
  check(r?.statDate === DAY, `stat_date=今天 UTC(实际 ${r?.statDate})`);

  const [d] = await db
    .select()
    .from(deviceDailyMetrics)
    .where(eq(deviceDailyMetrics.projectName, PROJ));
  check(d?.totalRequests === 5, `device_daily total=5(实际 ${d?.totalRequests})`);

  // ② 对账:清聚合(留 request_logs 种子)-> rebuildRecent -> 应从 request_logs 重灌
  await db.delete(rpcDailyMetrics).where(eq(rpcDailyMetrics.projectName, PROJ));
  await db.delete(deviceDailyMetrics).where(eq(deviceDailyMetrics.projectName, PROJ));
  await db.insert(requestLogs).values([
    { requestId: 'ms-rc-1', projectName: PROJ, actionName: ACT, clientId: CID, status: 'ok', latencyMs: 11, createdAt: new Date() },
    { requestId: 'ms-rc-2', projectName: PROJ, actionName: ACT, clientId: CID, status: 'timeout', latencyMs: 22, createdAt: new Date() },
  ]);
  await svc.rebuildRecent(3);
  const [rc] = await db
    .select()
    .from(rpcDailyMetrics)
    .where(eq(rpcDailyMetrics.projectName, PROJ));
  check(rc?.totalRequests === 2, `对账后 rpc_daily total=2(实际 ${rc?.totalRequests})`);
  check(rc?.successRequests === 1 && rc?.timeoutRequests === 1, '对账后 success=1 timeout=1');

  await clean();
  await pool.end();
  console.log(ok ? '\n=== METRICS SMOKE PASSED ===' : '\n=== METRICS SMOKE FAILED ===');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: package.json 加脚本**

`"device:stale:smoke"` 那行后加(补逗号):
```json
    "device:stale:smoke": "ts-node -r tsconfig-paths/register src/scripts/device-stale-smoke.ts",
    "metrics:smoke": "ts-node -r tsconfig-paths/register src/scripts/metrics-smoke.ts"
```

- [ ] **Step 3: 跑冒烟**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/metrics-smoke.ts 2>&1 | tail -16
```
Expected:`METRICS SMOKE PASSED`(累加 9 条 + 对账 3 条断言全 PASS)。

- [ ] **Step 4: prettier + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/prettier --write "src/**/*.ts" >/dev/null
cd /Users/lpitiless/Documents/R2RPC && git add backend/src/scripts/metrics-smoke.ts backend/package.json && git commit -m "test(3a): metrics aggregation pipeline direct smoke (recordCompletion + reconcile)"
```

---

## Task 5: 进度台账 + PR

**Files:** Modify `docs/后端进度.md`。

- [ ] **Step 1: 台账 #3 拆 3a/3b,3a → 🚧→✅,完成记录**

- 总览表 #3 行拆成 `3a`(✅)+ `3b`(⬜,依赖 3a);或在 #3 行标注「3a done / 3b todo」。
- `#3` 大块段落顶部标注 3a 完成、3b(读视图)待做。
- 完成记录顶部加:
```markdown
### 2026-07-09 · #3/3a 指标聚合管道 — PR #<n>
- 两日聚合表 `device_daily_metrics`(PK date+client+project)/`rpc_daily_metrics`(PK date+project+action+client,client_id='' 表无设备),对齐老系统;drop 没用的 `metrics` 空壳。派生/日志型,无 description/deleted_at。
- 完成累加 `MetricsService.recordCompletion`(per-completion upsert,ok/timeout/failed 归类 + total_latency 累加 + max GREATEST),挂 `RequestLogProcessor`;**去重**:`writeSpine` 返回首插标志,仅首见 requestId 才累加(重试不重复计)。
- 重启对账 `rebuildRecent(N)`:worker 启动删+从 request_logs 重灌最近 rawRetentionDays 天(UTC 分桶,同增量口径),修漂移。
- 按天清理 `cleanupOldMetrics`:maintenance `metrics-cleanup`(5min),删 stat_date 超 `aggregateRetentionDays`(默认 30)。
- 验证:build/lint/format 绿;直连冒烟 `metrics:smoke`(累加 + 对账 12 断言)绿。
- **读侧派生视图(weekly/trend/overview 改读聚合)= 3b**;GroupSummary/GroupInfo 归 #8。
- 计划:`docs/superpowers/plans/2026-07-09-3a-metrics-aggregation-pipeline.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add docs/后端进度.md && git commit -m "docs(3a): mark metrics aggregation pipeline done + 3b split" && git push -u origin feat/3-metrics-aggregation && gh pr create --base main --title "feat(3a): 指标聚合管道(日聚合表 + 完成累加 + 对账 + 清理)" --body "#3 指标聚合体系 3a(写入管道)。两日聚合表 + per-completion 累加(去重)+ 重启对账 + 30天清理。读视图=3b。计划见 docs/superpowers/plans/2026-07-09-3a-metrics-aggregation-pipeline.md"
```

- [ ] **Step 3:** 回填 PR 号到完成记录,补一提交。

---

## Self-Review

- **对齐老系统**(核心统计 §2.5/2.6/2.8/7.1/7.3):两日聚合表列/PK 一致(group→project 改名);per-completion 累加✓ 状态归类(ok/timeout/failed)✓ total_latency+max✓ 重启对账✓ 30天清理✓。
- **去重正确性**:`writeSpine` 首插判 → recordCompletion exactly-once,BullMQ 重试不重复计;对账兜底修崩溃漏计。
- **UTC 一致**:增量 `createdAt.slice(0,10)` 与对账 `(created_at AT TIME ZONE 'UTC')::date` 同 UTC 口径。
- **类型一致**:`recordCompletion(job)`/`rebuildRecent(days)`/`cleanupOldMetrics(days)` 与 processor/bootstrap 调用一致;`writeSpine → boolean` 与 processor 首插判一致;冒烟 news up `MetricsService({db})` 与构造签名一致。
- **DI**:MetricsModule exports MetricsService;WorkerModule import MetricsModule(worker 用,无环——MetricsService 只 DbService)。
- **聚合表豁免**:派生/日志型,无 description/deleted_at,读不 alive——与 request_logs 同类豁免,合规。
- **范围**:仅写入管道 + 对账 + 清理;读视图明确留 3b,GroupInfo 留 #8,无越界。
