# #8: 分组 enabled + GroupInfo 派生统计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans。Steps 用 `- [ ]`。

**Goal:** projects 加 `enabled`(启停)+ invoke 派发时校验禁用组拒派 + 启停端点;`GET /projects/info` 返回每 project 派生统计(设备数/在线数/近7天请求/成功率/lastSeen + 运行态 disabled·no_device·online·stale·offline)。

**Architecture:** 把已建的 projects + device↔project 归属(device_token_projects)+ devices 持久态(#2)+ rpc_daily_metrics(#3)+ enabled 拼成分组视图。GroupInfo 用 3 个查询(projects / 设备计数 join / 7天指标)在 JS 合并,不 N+1。运行态按 doc §174 派生。

**Tech Stack:** NestJS 11 · drizzle-orm(join/count/group-by/sum)· class-validator。

## Global Constraints
- 已在分支 `feat/8-project-enabled-groupinfo`。功能分支 → PR → 合并。
- 提交/PR 前(`backend/`,**不用 `pnpm <script>`**,直接 `node_modules/.bin/{nest,eslint,prettier,drizzle-kit,ts-node}`):build + lint + format 全过。
- **运行态派生**(doc §174):`enabled=false`→`disabled`;`totalDevices=0`→`no_device`;`onlineDevices>0`→`online`;`lastSeenAt<今-7天`(非空)→`stale`;其余→`offline`。**顺序即优先级**。
- **enabled 只在 invoke 派发点校验**(rpc.service);设备 WS 连接不查 enabled(简化,禁用=不派发即够)。
- **在线数用 `devices.online`**(PG,stale-scan worker 保鲜)——不逐 project 打 Redis。
- 有 API → e2e 走 HTTP([[api-vs-pg-boundary]])。

## File Structure
- Modify `src/application/projects/projects.schema.ts` — 加 `enabled`。
- Modify `src/application/projects/projects.service.ts` — `findEnabledIdByName` / `setEnabled` / `groupInfo`(注入 MetricsService)。
- Modify `src/application/projects/projects.controller.ts` — 启停端点 + `GET info`。
- Create `src/application/projects/dto/set-enabled.dto.ts`。
- Modify `src/application/projects/projects.module.ts` — imports MetricsModule。
- Modify `src/application/metrics/metrics.service.ts` — `requests7dByProject()`。
- Modify `src/application/rpc/rpc.service.ts` — 派发 enabled 校验(status `disabled` 403)。
- Modify `src/scripts/seed-admin.ts` — `update/project` 权限。
- Modify `test/smoke.e2e.js` — enabled 拦截 + groupInfo 断言。
- 新迁移 `0005_*.sql`。

---

## Task 1: projects.enabled + 启停端点 + 迁移

**Files:** `projects.schema.ts`, `projects.service.ts`, `projects.controller.ts`, `dto/set-enabled.dto.ts`, `seed-admin.ts`;迁移。

- [ ] **Step 1: projects.schema 加 enabled**

import 加 `boolean`;表定义 `description` 之后加:
```ts
    description: varchar('description', { length: 255 }),
    enabled: boolean('enabled').notNull().default(true),
```

- [ ] **Step 2: ProjectsService 加 findEnabledIdByName + setEnabled**(类内加)

```ts
  // 供 invoke 派发:一把查出 id + enabled(alive)
  async findEnabledIdByName(name: string) {
    const [row] = await this.db
      .select({ id: projects.id, enabled: projects.enabled })
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return row ?? null;
  }

  // 启停(alive)
  async setEnabled(id: number, enabled: boolean) {
    const [row] = await this.db
      .update(projects)
      .set({ enabled })
      .where(alive(projects, eq(projects.id, id)))
      .returning({ id: projects.id, name: projects.name, enabled: projects.enabled });
    if (!row) throw new NotFoundException('功能组不存在');
    return row;
  }
```
> 顶部 import 补 `NotFoundException`(`@nestjs/common`)。`eq`/`alive` 已在用。

- [ ] **Step 3: 建 `dto/set-enabled.dto.ts`**

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
```

- [ ] **Step 4: ProjectsController 加启停端点**

import 补 `Body`/`ParseIntPipe`(若缺)+ DTO;类内 `remove` 之后加:
```ts
  @Post(':id/enabled')
  @RequirePermission('update', 'project')
  @ApiOperation({ summary: '启用/停用功能组(停用后 invoke 拒派)' })
  setEnabled(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetEnabledDto,
  ) {
    return this.projects.setEnabled(id, dto.enabled);
  }
```

- [ ] **Step 5: seed-admin 加 update/project 权限**

`ALL_PERMISSIONS` 在 `{ action: 'delete', subject: 'project' },` 之后加:
```ts
  { action: 'delete', subject: 'project' },
  { action: 'update', subject: 'project' },
```

- [ ] **Step 6: 生成 + 应用迁移 + reseed + build**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
node_modules/.bin/drizzle-kit generate
grep -nE 'ADD COLUMN "enabled"' drizzle/0005_*.sql
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/migrate.ts
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts 2>&1 | tail -2
node_modules/.bin/nest build 2>&1 | tail -3
```
Expected:`0005` 有 `ADD COLUMN "enabled"`(非交互);`迁移完成`;seed「权限 15 条」;build 0。

- [ ] **Step 7: 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src backend/drizzle && git commit -m "feat(8): projects.enabled column + 启停 endpoint + update/project permission + migration"
```

---

## Task 2: invoke 派发校验 enabled

**Files:** `rpc.service.ts`。

- [ ] **Step 1: 派发点改用 findEnabledIdByName + 禁用拒派**

定位 `invoke()` 里(rpc.service.ts):
```ts
    // project 名 -> project id(DB 查询;不存在直接 404,不算基础设施异常)
    let projectId: number | null;
    try {
      projectId = await this.projects.idByName(p.project);
    } catch (e) {
      this.logger.error(`功能组解析失败(基础设施异常): ${(e as Error).message}`);
      return this.fail(p, requestId, null, startedAt, 'error', 503, '基础设施异常,无法调度');
    }
    if (!projectId) {
      return this.fail(p, requestId, null, startedAt, 'no_project', 404, '功能组不存在');
    }
```
替换为(查 id+enabled,禁用拒派):
```ts
    // project 名 -> {id, enabled}(DB 查询;不存在 404、禁用 403,均不算基础设施异常)
    let proj: { id: number; enabled: boolean } | null;
    try {
      proj = await this.projects.findEnabledIdByName(p.project);
    } catch (e) {
      this.logger.error(`功能组解析失败(基础设施异常): ${(e as Error).message}`);
      return this.fail(p, requestId, null, startedAt, 'error', 503, '基础设施异常,无法调度');
    }
    if (!proj) {
      return this.fail(p, requestId, null, startedAt, 'no_project', 404, '功能组不存在');
    }
    if (!proj.enabled) {
      return this.fail(p, requestId, null, startedAt, 'disabled', 403, '功能组已停用');
    }
    const projectId = proj.id;
```
> 下游用 `projectId`(pickOnline 等)不变。`no_project`/`disabled` 都进 `fail()` → 落 request_logs.status → 指标归 failed。

- [ ] **Step 2: build + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -3
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src/application/rpc/rpc.service.ts && git commit -m "feat(8): reject invoke dispatch to disabled project (status=disabled 403)"
```

---

## Task 3: GroupInfo 派生统计端点

**Files:** `metrics.service.ts`, `projects.service.ts`, `projects.controller.ts`, `projects.module.ts`。

- [ ] **Step 1: MetricsService 加 requests7dByProject**(类内加)

```ts
  // 近7天每 project 的请求/成功数(供 GroupInfo)。返回 project_name -> {requests7d, success7d}
  async requests7dByProject() {
    const cutoffDate = this.utcDateNDaysAgo(6);
    const rows = await this.db
      .select({
        project: rpcDailyMetrics.projectName,
        requests7d: sql<number>`sum(${rpcDailyMetrics.totalRequests})::int`,
        success7d: sql<number>`sum(${rpcDailyMetrics.successRequests})::int`,
      })
      .from(rpcDailyMetrics)
      .where(gte(rpcDailyMetrics.statDate, cutoffDate))
      .groupBy(rpcDailyMetrics.projectName);
    return new Map(rows.map((r) => [r.project, r]));
  }
```
> `utcDateNDaysAgo`/`gte`/`sql`/`rpcDailyMetrics` 均已在文件内(3a/3b)。

- [ ] **Step 2: ProjectsModule import MetricsModule**

`projects.module.ts` 的 `@Module` 加 `imports: [MetricsModule]`(从 `../metrics/metrics.module`)。

- [ ] **Step 3: ProjectsService 加 groupInfo**(注入 MetricsService + 查设备计数 + 合并派生)

顶部 import 补:
```ts
import { and, count, eq, max, sql } from 'drizzle-orm';
import { devices } from '../devices/devices.schema';
import { deviceTokens } from '../device-token/device-token.schema';
import { deviceTokenProjects } from '../device-token/device-token.schema';
import { MetricsService } from '../metrics/metrics.service';
```
构造函数注入 MetricsService:
```ts
  constructor(
    private readonly dbService: DbService,
    private readonly metrics: MetricsService,
  ) {}
```
类内加:
```ts
  // 每 project 派生统计(设备数/在线数/近7天/成功率/lastSeen + 运行态)
  async groupInfo() {
    const projs = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        enabled: projects.enabled,
      })
      .from(projects)
      .where(alive(projects))
      .orderBy(projects.id);

    // 设备计数:devices → device_tokens → device_token_projects,按 project_id 汇总(alive 设备)
    const devRows = await this.db
      .select({
        projectId: deviceTokenProjects.projectId,
        total: count(),
        online: sql<number>`count(*) filter (where ${devices.online})::int`,
        lastSeen: max(devices.lastSeenAt),
      })
      .from(devices)
      .innerJoin(deviceTokens, eq(devices.deviceTokenId, deviceTokens.id))
      .innerJoin(
        deviceTokenProjects,
        eq(deviceTokens.id, deviceTokenProjects.tokenId),
      )
      .where(alive(devices))
      .groupBy(deviceTokenProjects.projectId);
    const devByProject = new Map(devRows.map((r) => [r.projectId, r]));

    const m7d = await this.metrics.requests7dByProject();

    const now = Date.now();
    const SEVEN_DAYS = 7 * 86_400_000;
    return projs.map((p) => {
      const d = devByProject.get(p.id);
      const total = Number(d?.total ?? 0);
      const online = Number(d?.online ?? 0);
      const lastSeenAt = d?.lastSeen ?? null;
      const met = m7d.get(p.name);
      const requests7d = Number(met?.requests7d ?? 0);
      const success7d = Number(met?.success7d ?? 0);
      const status = !p.enabled
        ? 'disabled'
        : total === 0
          ? 'no_device'
          : online > 0
            ? 'online'
            : lastSeenAt && now - new Date(lastSeenAt).getTime() > SEVEN_DAYS
              ? 'stale'
              : 'offline';
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        enabled: p.enabled,
        totalDevices: total,
        onlineDevices: online,
        lastSeenAt,
        requests7d,
        success7d,
        successRate: requests7d
          ? Math.round((success7d * 10000) / requests7d) / 100
          : 0,
        status,
      };
    });
  }
```

- [ ] **Step 4: ProjectsController 加 GET info**

`list()` 之前或之后加:
```ts
  @Get('info')
  @RequirePermission('read', 'project')
  @ApiOperation({ summary: '功能组派生统计(设备数/在线/近7天/成功率/运行态)' })
  info() {
    return this.projects.groupInfo();
  }
```
> ⚠️ `@Get('info')` 必须在 `@Get(':id')` 类端点**之前**声明(若有),否则 `info` 会被 `:id` 吞。当前 controller 无 `:id` GET,放哪都行,但保险起见放 `@Get()`(list)之后、任何 `:id` 之前。

- [ ] **Step 5: build + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -6
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src && git commit -m "feat(8): GET /projects/info GroupInfo derived stats (device counts + 7d metrics + status)"
```

---

## Task 4: 冒烟(enabled 拦截 + groupInfo)

**Files:** `test/smoke.e2e.js`。

- [ ] **Step 1: 加断言**(在 device-token/metrics 断言区之后、`ws.close()` 前)

设备已自注册在 cn-nodes(smoke 前面已连)。加:
```ts
  // #8:GroupInfo + 分组启停
  const gi = await http('GET', '/projects/info', null, admin);
  assert(gi.status === 200 && Array.isArray(gi.json), '/projects/info -> 200 数组');
  const cn = (gi.json || []).find((x) => x.name === 'cn-nodes');
  assert(
    !!cn && typeof cn.totalDevices === 'number' && typeof cn.onlineDevices === 'number' && typeof cn.status === 'string',
    'GroupInfo cn-nodes 含 totalDevices/onlineDevices/status',
  );
  assert(cn.onlineDevices >= 1 && cn.status === 'online', 'cn-nodes 有在线设备 -> status online');

  // 停用 cn-nodes -> invoke 该组应被拒(disabled 403),GroupInfo status=disabled
  const projList = await http('GET', '/projects', null, admin);
  const cnProj = (projList.json || []).find((x) => x.name === 'cn-nodes');
  const disable = await http('POST', `/projects/${cnProj.id}/enabled`, { enabled: false }, admin);
  assert(disable.status < 300 && disable.json.enabled === false, '停用 cn-nodes');
  const invDisabled = await http('POST', '/rpc/invoke/cn-nodes/echo', { payload: {} }, accessToken);
  assert(invDisabled.status === 403 || invDisabled.json.status === 'disabled', '停用后 invoke cn-nodes -> disabled 拒派');
  const gi2 = await http('GET', '/projects/info', null, admin);
  const cn2 = (gi2.json || []).find((x) => x.name === 'cn-nodes');
  assert(cn2.status === 'disabled', 'GroupInfo cn-nodes status=disabled');
  // 复原,免影响后续/重跑
  await http('POST', `/projects/${cnProj.id}/enabled`, { enabled: true }, admin);
```
> `accessToken`(smoke 前面建的 cn-nodes access token)在作用域内可用。invoke 返回体:`fail()` 的 http 层是 200 带 `json.status='disabled'`?还是 HTTP 403?——**确认**:`invoke` 控制器直接返回 `rpc.invoke()` 的结果对象(HTTP 200),`status`/`httpCode` 在 body 里。故断言用 `invDisabled.json.status === 'disabled'`(body),别指望 HTTP 403。执行时按实际返回调整该断言。

- [ ] **Step 2: build + 起 API + 跑 smoke**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
node_modules/.bin/nest build 2>&1 | tail -2
pkill -f 'node dist/main.js' 2>/dev/null; sleep 1
node dist/main.js > /tmp/api-8.log 2>&1 &
for i in $(seq 1 25); do curl -s -o /dev/null -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123456"}' && break; sleep 1; done
node test/smoke.e2e.js 2>&1 | tail -30
pkill -f 'node dist/main.js' 2>/dev/null
```
Expected:全 PASS + `SMOKE PASSED`,含 GroupInfo + 启停拦截断言。FAIL 别提交。

- [ ] **Step 3: prettier + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/prettier --write "test/**/*.js" >/dev/null
cd /Users/lpitiless/Documents/RER0RPC && git add backend/test/smoke.e2e.js && git commit -m "test(8): project enabled dispatch-block + GroupInfo smoke assertions"
```

---

## Task 5: 进度台账 + PR

**Files:** `docs/后端进度.md`。

- [ ] **Step 1: 台账 #8 → ✅ + 完成记录**

- 总览表 `#8` 行 ⬜→✅。#8 段落标注完成。
- 完成记录顶部加:
```markdown
### 2026-07-09 · #8 分组 enabled + GroupInfo — PR #<n>
- projects 加 `enabled`(启停);invoke 派发查 `findEnabledIdByName`,禁用组返 `disabled`(403 body)拒派;`POST /projects/:id/enabled` 启停(`update/project` 权限,→15 条)。
- `GET /projects/info` GroupInfo 派生:每 project 设备数/在线数(devices join device_token_projects)/近7天请求·成功·成功率(rpc_daily_metrics)/lastSeen + 运行态(disabled/no_device/online/stale/offline,doc §174 顺序派生)。3 查询 JS 合并,不 N+1;ProjectsModule import MetricsModule。
- 验证:build/lint/format 绿;e2e smoke 加 GroupInfo + 启停拦截断言全绿。
- 计划:`docs/superpowers/plans/2026-07-09-8-project-enabled-groupinfo.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add docs/后端进度.md && git commit -m "docs(8): mark project enabled + GroupInfo done" && git push -u origin feat/8-project-enabled-groupinfo && gh pr create --base main --title "feat(8): 分组 enabled + GroupInfo 派生统计" --body "projects 启停 + invoke 拒派禁用组 + GET /projects/info 派生视图(设备/在线/7天/成功率/运行态)。计划见 docs/superpowers/plans/2026-07-09-8-project-enabled-groupinfo.md"
```

- [ ] **Step 3:** 回填 PR 号到完成记录,补一提交。

---

## Self-Review
- **对齐老系统**:GroupInfo 字段(totalDevices/onlineDevices/requests7d/success7d/successRate/lastSeenAt/status)+ 运行态派生顺序(disabled>no_device>online>stale>offline)同 doc §156-174。
- **enabled 校验**:只在 invoke 派发点(`findEnabledIdByName`),禁用 → `fail('disabled',403)` 落日志/指标;设备连接不拦(简化)。
- **不 N+1**:groupInfo 3 查询(projects / 设备计数 group-by / 7天指标 group-by)JS 合并。
- **DI**:ProjectsModule import MetricsModule(MetricsModule 已 export MetricsService;无环——MetricsModule 不依赖 ProjectsModule)。
- **类型一致**:`findEnabledIdByName→{id,enabled}|null`、`setEnabled(id,bool)`、`groupInfo()`、`requests7dByProject()→Map` 与调用方一致。
- **路由顺序**:`@Get('info')` 静态路径,当前 controller 无 `:id` GET 冲突。
- **在线数口径**:`devices.online`(PG,stale worker ≤60s 保鲜),非实时 Redis——GroupInfo 是看板统计,可接受。
