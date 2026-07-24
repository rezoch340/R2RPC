# 3b: 指标读视图(weekly + trend)实现计划

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans。Steps 用 `- [ ]`。

**Goal:** 给 metrics 加两个读聚合表的派生视图 API:`GET /metrics/weekly`(近7天设备指标,读 `device_daily_metrics`)+ `GET /metrics/trend`(按天序列、补零,读 `rpc_daily_metrics`),对齐老系统 WeeklyMetric/TrendPoint。**不动 `overview`**(它扫 request_logs,retention 封顶 3 天、成本有界)。GroupSummary/GroupInfo 归 #8。

**Architecture:** 3a 已建两日聚合表 + 累加/对账。3b 纯**读**:SUM/MAX 聚合查询 + trend 在 JS 里生成 UTC 日期序列左连补零。日期用 UTC(同 3a 分桶口径)。

**Tech Stack:** NestJS 11 · drizzle-orm(`sql` 聚合)· class-validator。

## Global Constraints
- 已在分支 `feat/3b-metrics-read-views`。功能分支 → PR → 合并。
- 提交/PR 前(`backend/`,**不用 `pnpm <script>`** 避沙箱 install 坑,直接 `node_modules/.bin/{nest,eslint,prettier}`):build + lint + format 全过。
- 有 API → e2e 走 HTTP([[api-vs-pg-boundary]]);不新增直连脚本(数据正确性 3a 的 `metrics:smoke` 已覆盖)。
- 无 schema/迁移改动。

## File Structure
- Modify `src/application/metrics/metrics.service.ts` — 加 `weekly()` / `trend()` + 私有 UTC 日期助手。
- Create `src/application/metrics/dto/query-trend.dto.ts` — `QueryTrendDto`。
- Modify `src/application/metrics/metrics.controller.ts` — 加 `weekly` / `trend` 端点。
- Modify `test/smoke.e2e.js` — 加 weekly/trend 断言。

---

## Task 1: MetricsService weekly+trend + DTO + controller 端点

**Files:** `metrics.service.ts`, `dto/query-trend.dto.ts`, `metrics.controller.ts`。

- [ ] **Step 1: metrics.service 顶部 import 补齐**

现有 `import { desc, gte, lt, sql } from 'drizzle-orm';` 改为含 `and`/`eq`:
```ts
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
```

- [ ] **Step 2: 加私有 UTC 日期助手 + weekly + trend**(加到 `MetricsService` 类内,`overview()` 之后)

```ts
  // 今天(UTC)往前 n 天的日期串 'YYYY-MM-DD'
  private utcDateNDaysAgo(n: number): string {
    const now = new Date();
    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n),
    )
      .toISOString()
      .slice(0, 10);
  }

  // 近7天设备指标:按 (clientId, project) 汇总 device_daily_metrics(可选 project 过滤)
  async weekly(project?: string) {
    const cutoffDate = this.utcDateNDaysAgo(6); // 含今天共 7 天
    const conds = [gte(deviceDailyMetrics.statDate, cutoffDate)];
    if (project) conds.push(eq(deviceDailyMetrics.projectName, project));
    return this.db
      .select({
        clientId: deviceDailyMetrics.clientId,
        project: deviceDailyMetrics.projectName,
        totalRequests: sql<number>`sum(${deviceDailyMetrics.totalRequests})::int`,
        successRequests: sql<number>`sum(${deviceDailyMetrics.successRequests})::int`,
        failedRequests: sql<number>`sum(${deviceDailyMetrics.failedRequests})::int`,
        timeoutRequests: sql<number>`sum(${deviceDailyMetrics.timeoutRequests})::int`,
        avgLatencyMs: sql<number>`coalesce(round(sum(${deviceDailyMetrics.totalLatencyMs})::numeric / nullif(sum(${deviceDailyMetrics.totalRequests}), 0)), 0)::int`,
        maxLatencyMs: sql<number>`coalesce(max(${deviceDailyMetrics.maxLatencyMs}), 0)::int`,
      })
      .from(deviceDailyMetrics)
      .where(and(...conds))
      .groupBy(deviceDailyMetrics.clientId, deviceDailyMetrics.projectName)
      .orderBy(desc(sql`sum(${deviceDailyMetrics.totalRequests})`));
  }

  // 按天趋势:近 days 天 rpc_daily_metrics 汇总,JS 生成 UTC 日期序列补零(缺的天填 0)
  async trend(days: number, project?: string) {
    const cutoffDate = this.utcDateNDaysAgo(days - 1);
    const conds = [gte(rpcDailyMetrics.statDate, cutoffDate)];
    if (project) conds.push(eq(rpcDailyMetrics.projectName, project));
    const rows = await this.db
      .select({
        statDate: rpcDailyMetrics.statDate,
        total: sql<number>`sum(${rpcDailyMetrics.totalRequests})::int`,
        success: sql<number>`sum(${rpcDailyMetrics.successRequests})::int`,
        failed: sql<number>`sum(${rpcDailyMetrics.failedRequests})::int`,
        timeout: sql<number>`sum(${rpcDailyMetrics.timeoutRequests})::int`,
        totalLat: sql<number>`sum(${rpcDailyMetrics.totalLatencyMs})::bigint`,
        maxLat: sql<number>`coalesce(max(${rpcDailyMetrics.maxLatencyMs}), 0)::int`,
      })
      .from(rpcDailyMetrics)
      .where(and(...conds))
      .groupBy(rpcDailyMetrics.statDate);
    const byDate = new Map(rows.map((r) => [String(r.statDate), r]));
    const points = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = this.utcDateNDaysAgo(i);
      const r = byDate.get(d);
      const total = Number(r?.total ?? 0);
      const success = Number(r?.success ?? 0);
      points.push({
        statDate: d,
        totalRequests: total,
        successRequests: success,
        failedRequests: Number(r?.failed ?? 0),
        timeoutRequests: Number(r?.timeout ?? 0),
        avgLatencyMs: total ? Math.round(Number(r?.totalLat ?? 0) / total) : 0,
        maxLatencyMs: Number(r?.maxLat ?? 0),
        successRate: total
          ? Math.round((success * 10000) / total) / 100
          : 0,
      });
    }
    return points;
  }
```
> `statDate` 是 `date` 列,drizzle 返回字符串 `'YYYY-MM-DD'`,与 `utcDateNDaysAgo` 对齐。`deviceDailyMetrics`/`rpcDailyMetrics` 已在文件顶部 import(3a)。

- [ ] **Step 3: 建 `dto/query-trend.dto.ts`**

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryTrendDto {
  @ApiPropertyOptional({ default: 7, description: '天数,1-90' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @ApiPropertyOptional({ description: '按 project 过滤' })
  @IsOptional()
  @IsString()
  project?: string;
}
```

- [ ] **Step 4: metrics.controller 加两端点**

import 补 `Query` + DTO:
```ts
import { Controller, Get, Query } from '@nestjs/common';
import { QueryTrendDto } from './dto/query-trend.dto';
```
类内(`overview()` 之后)加:
```ts
  @Get('weekly')
  @RequirePermission('read', 'metrics')
  @ApiOperation({ summary: '近7天设备指标(按 clientId×project 汇总;可选 ?project)' })
  weekly(@Query('project') project?: string) {
    return this.metrics.weekly(project);
  }

  @Get('trend')
  @RequirePermission('read', 'metrics')
  @ApiOperation({ summary: '按天趋势序列(默认近7天,缺天补零;可选 ?days ?project)' })
  trend(@Query() q: QueryTrendDto) {
    return this.metrics.trend(q.days ?? 7, q.project);
  }
```

- [ ] **Step 5: build + lint + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -3 && node_modules/.bin/eslint "src/application/metrics/**/*.ts" --fix
cd /Users/lpitiless/Documents/R2RPC && git add backend/src/application/metrics && git commit -m "feat(3b): metrics weekly + trend read views from daily aggregates"
```
Expected: build 0,lint 无错。

---

## Task 2: e2e 冒烟(weekly/trend 走 API)

**Files:** `test/smoke.e2e.js`。

- [ ] **Step 1: 在现有 `metrics overview` 断言之后加 weekly/trend 断言**

现有 smoke 有:
```js
  const m = await http('GET', '/metrics/overview', null, admin);
  assert(m.json.totals && typeof m.json.totals.total === 'number', 'metrics overview');
```
其后加:
```js
  const wk = await http('GET', '/metrics/weekly', null, admin);
  assert(wk.status === 200 && Array.isArray(wk.json), '/metrics/weekly -> 200 数组');
  const tr = await http('GET', '/metrics/trend?days=7', null, admin);
  assert(tr.status === 200 && Array.isArray(tr.json) && tr.json.length === 7, '/metrics/trend?days=7 -> 7 个按天点(补零)');
  assert(
    tr.json.every((p) => typeof p.statDate === 'string' && typeof p.totalRequests === 'number' && typeof p.successRate === 'number'),
    'trend 每点含 statDate/totalRequests/successRate',
  );
```
> 注:smoke 只起 API(无 worker),聚合表可能空 → weekly 返 `[]`、trend 返 7 个零点。断言只校形状/补零/权限(数据正确性 3a `metrics:smoke` 已覆盖)。

- [ ] **Step 2: build + 起 API + 跑 smoke**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend
node_modules/.bin/nest build 2>&1 | tail -2
pkill -f 'node dist/main.js' 2>/dev/null; sleep 1
node dist/main.js > /tmp/api-3b.log 2>&1 &
for i in $(seq 1 25); do curl -s -o /dev/null -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123456"}' && break; sleep 1; done
node test/smoke.e2e.js 2>&1 | tail -20
pkill -f 'node dist/main.js' 2>/dev/null
```
Expected: 全 PASS + `SMOKE PASSED`,含 3 条新 weekly/trend 断言。FAIL 别提交。

- [ ] **Step 3: prettier + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/prettier --write "test/**/*.js" >/dev/null
cd /Users/lpitiless/Documents/R2RPC && git add backend/test/smoke.e2e.js && git commit -m "test(3b): metrics weekly/trend API smoke assertions"
```

---

## Task 3: 进度台账 + PR

**Files:** `docs/后端进度.md`。

- [ ] **Step 1: 台账 3b → ✅ + #3 收尾 + 完成记录**

- 总览表 `3b` 行 ⬜→✅;`#3` 大块段落标注 3a+3b 完成、`#3` 整体 ✅(GroupSummary/GroupInfo 仍在 #8)。
- 完成记录顶部加:
```markdown
### 2026-07-09 · #3/3b 指标读视图 — PR #<n>(#3 收尾)
- `GET /metrics/weekly`(近7天按 clientId×project 汇总 `device_daily_metrics`,avg=sum(total_latency)/sum(total),可选 ?project)。
- `GET /metrics/trend`(近 days 天按天汇总 `rpc_daily_metrics`,JS 生成 UTC 日期序列补零,含 successRate;?days 1-90 默认7,可选 ?project)。均 `read/metrics`,mirror 老系统 WeeklyMetric/TrendPoint。overview 不动(扫 raw,3 天有界)。
- 验证:build/lint/format 绿;e2e smoke 加 weekly/trend 形状+补零断言全绿。
- **#3 指标聚合体系完成**(3a 管道 + 3b 读视图)。GroupSummary/GroupInfo 归 #8。
- 计划:`docs/superpowers/plans/2026-07-09-3b-metrics-read-views.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add docs/后端进度.md && git commit -m "docs(3b): mark metrics read views done + #3 complete" && git push -u origin feat/3b-metrics-read-views && gh pr create --base main --title "feat(3b): 指标读视图(weekly + trend)" --body "#3 收尾。weekly(近7天设备)+ trend(按天补零)读聚合表 API。overview 不动。计划见 docs/superpowers/plans/2026-07-09-3b-metrics-read-views.md"
```

- [ ] **Step 3:** 回填 PR 号到完成记录,补一提交。

---

## Self-Review
- **对齐老系统**:WeeklyMetric(设备7天,avg=Σlat/Σtotal,max=MAX)/ TrendPoint(按天,补零,successRate=success*100/total)语义一致(group→project 改名)。
- **UTC 一致**:trend 日期序列与 3a 分桶同 UTC 口径,补零日期对齐 `statDate` 字符串。
- **类型一致**:`weekly(project?)`/`trend(days, project?)` 与 controller 调用一致;`QueryTrendDto.days` 夹 [1,90] 默认 7。
- **不越界**:只加读端点,不动 overview / schema / worker;GroupSummary/GroupInfo 留 #8。
- **除零**:weekly avg 用 `nullif(...,0)` + coalesce;trend avg/successRate JS 端 `total ? ... : 0`。
