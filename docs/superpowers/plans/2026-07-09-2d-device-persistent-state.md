# 2d: 设备持久态(stale 扫描 + 列表/详情 API + platform/ip/extra/status)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** device-model epic 收尾。给 `devices` 落齐 `platform/last_ip/extra/status` 列;上线时从连接捕获 platform/ip/extra 并置 `status='online'`;加**后台 stale 扫描 worker**(PG `online=true` 但 Redis presence 已过期 → 置 `offline`+`status='stale'`);加**设备列表/详情只读 API**(`read/device`)。

**Architecture:** stale 检测走 **Redis presence 对账**(presence TTL 即在线真源,无需时间阈值):worker 定时扫 PG 里 online 的设备,presence 键没了就置 stale。`DevicesService` 注入 `RedisService`(@Global)自己查 presence 键,**不依赖 WsModule**(避免 WsModule↔DevicesModule 环)。列表/详情 mirror `MonitorController` 的 `read` 权限模式。

**Tech Stack:** NestJS 11 · drizzle-orm 0.45 · BullMQ(maintenance 队列)· ioredis · class-validator。

## Global Constraints

- **不直接提交 main。** 已在分支 `feat/2d-device-persistent-state`。功能分支 → PR → 合并。
- **提交/PR 前**(从 `backend/` 跑,**不用 `pnpm <script>`**——包装器会跑失败的 `pnpm install`;直接 `node_modules/.bin/{nest build,eslint,prettier,drizzle-kit,ts-node}`):`nest build`(0)+ eslint + prettier。
- **迁移增量**:`devices` 加列 → `drizzle-kit generate` 出 `0003`(纯 ADD COLUMN,非交互),migrate + reseed。
- **实体表铁律**([[entity-tables-need-description]]/[[soft-delete-non-log-entities]]):`devices` 已有 `description`+`deleted_at`,新增列不破坏;list/detail 读要过滤 `alive()`。
- **有 API 走 API 验证**([[api-vs-pg-boundary]]):列表/详情有 API → 冒烟走 HTTP;**stale 扫描无 API 面** → 单独直连 PG+Redis 冒烟(mirror `retention-smoke`)。
- **DI 无环**:`DevicesService` 只注入 `DbService`+`RedisService`(都 @Global),**不 import WsModule**。`WorkerModule` import `DevicesModule` 给 `MaintenanceProcessor` 用 `DevicesService`(worker 进程,无 WsGateway)。
- **clientId 隔离本子项不做**(用户决策:先只轮询):`?clientId=` 定向代码保留;clientId 信任硬化记为待办。

---

## File Structure

- **改** `src/application/devices/devices.schema.ts` — 加 `status/platform/last_ip/extra`。
- **改** `src/application/devices/devices.service.ts` — `registerOnline` 收 meta+置 status;`markOffline` 置 status;加 `markStaleOffline`(注入 Redis)+ `list`/`get`。
- **改** `src/infrastructure/ws/ws.gateway.ts` — handleConnection 捕获 platform/ip/extra 传给 registerOnline。
- **改** `src/application/devices/devices.controller.ts` — 列表/详情端点(`read/device`)。
- **改** `src/application/request-logs/worker.bootstrap.ts` — 加 `mark-devices-stale` 定时任务。
- **改** `src/application/request-logs/maintenance.processor.ts` — 注入 DevicesService + dispatch。
- **改** `src/worker.module.ts` — imports 加 `DevicesModule`。
- **改** `src/scripts/seed-admin.ts` — 加 `read/device` 权限。
- **新** `src/scripts/device-stale-smoke.ts` + `package.json` 脚本(worker 逻辑直连冒烟)。
- **改** `test/smoke.e2e.js` — 设备列表/详情 + status/platform 断言。
- **新迁移** `0003_*.sql`。

---

## Task 1: devices 加列 + 迁移

**Files:** Modify `src/application/devices/devices.schema.ts`;Generate `drizzle/0003_*.sql`。

- [ ] **Step 1: devices.schema 加 4 列**

import 区加 `text`:
```ts
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
```
表定义在 `online` 之后、`description` 之前加(status 有默认值,platform/ip/extra 可空):
```ts
    online: boolean('online').notNull().default(false),
    status: varchar('status', { length: 16 }).notNull().default('offline'), // online/offline/stale
    platform: varchar('platform', { length: 64 }),
    lastIp: varchar('last_ip', { length: 64 }),
    extra: text('extra'),
    description: varchar('description', { length: 255 }),
```

- [ ] **Step 2: 生成 + 应用迁移 + reseed**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
node_modules/.bin/drizzle-kit generate
grep -nE 'ADD COLUMN "(status|platform|last_ip|extra)"' drizzle/0003_*.sql
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/migrate.ts
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts
node_modules/.bin/drizzle-kit generate
```
Expected: `0003_*.sql` 有 4 个 ADD COLUMN;**无交互 prompt**;`迁移完成`;seed 无报错;末次 generate `No schema changes`。

- [ ] **Step 3: build + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -3
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src/application/devices/devices.schema.ts backend/drizzle && git commit -m "feat(2d): devices add status/platform/last_ip/extra columns + migration"
```

---

## Task 2: registerOnline 收 meta+status · markOffline status · stale 扫描 worker

**Files:** Modify `devices.service.ts`, `ws.gateway.ts`, `worker.bootstrap.ts`, `maintenance.processor.ts`, `worker.module.ts`。

**Interfaces:**
- Produces:`DevicesService.registerOnline(clientId, deviceTokenId, meta?)`、`markOffline(clientId)`(置 status)、`markStaleOffline(): Promise<number>`。
- Consumes:`RedisService`(@Global,查 `presence:{clientId}`)。

- [ ] **Step 1: DevicesService 改造**(全文替换)

```ts
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { alive } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { devices } from './devices.schema';

interface DeviceMeta {
  platform?: string | null;
  lastIp?: string | null;
  extra?: string | null;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly dbService: DbService,
    private readonly redis: RedisService,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  // 设备上线:按 client_id upsert;置 online/status=online + 捕获 platform/ip/extra
  async registerOnline(
    clientId: string,
    deviceTokenId: number,
    meta: DeviceMeta = {},
  ): Promise<void> {
    const fields = {
      deviceTokenId,
      online: true,
      status: 'online',
      platform: meta.platform ?? null,
      lastIp: meta.lastIp ?? null,
      extra: meta.extra ?? null,
      lastSeenAt: new Date(),
    };
    const [existing] = await this.db
      .select({ id: devices.id })
      .from(devices)
      .where(alive(devices, eq(devices.clientId, clientId)))
      .limit(1);
    if (existing) {
      await this.db.update(devices).set(fields).where(eq(devices.id, existing.id));
    } else {
      await this.db.insert(devices).values({ clientId, ...fields });
    }
  }

  // 优雅下线:online=false + status=offline
  async markOffline(clientId: string): Promise<void> {
    await this.db
      .update(devices)
      .set({ online: false, status: 'offline' })
      .where(alive(devices, eq(devices.clientId, clientId)));
  }

  // stale 对账:PG online=true 但 Redis presence 已过期(设备实际掉线)→ 置 offline/stale。返回置 stale 条数。
  // ponytail: 逐设备 EXISTS,设备量大再改 pipeline。presence 键约定同 PresenceService(presence:{clientId})。
  async markStaleOffline(): Promise<number> {
    const rows = await this.db
      .select({ id: devices.id, clientId: devices.clientId })
      .from(devices)
      .where(alive(devices, eq(devices.online, true)));
    let stale = 0;
    for (const d of rows) {
      const present = await this.redis.client.exists(`presence:${d.clientId}`);
      if (present === 0) {
        await this.db
          .update(devices)
          .set({ online: false, status: 'stale' })
          .where(eq(devices.id, d.id));
        stale++;
      }
    }
    return stale;
  }

  // 列表:所有 alive 设备(按 id 倒序)
  async list() {
    return this.db
      .select()
      .from(devices)
      .where(alive(devices))
      .orderBy(devices.id);
  }

  // 详情:单台(alive),不存在返回 null
  async get(id: number) {
    const [row] = await this.db
      .select()
      .from(devices)
      .where(alive(devices, eq(devices.id, id)))
      .limit(1);
    return row ?? null;
  }
}
```
> 注:`and` 已 import 备用(list 若日后加过滤);当前 list 无过滤,若 lint 报 `and` 未用,删掉该 import。

- [ ] **Step 2: ws.gateway 捕获 meta 传入**

在 `handleConnection` 里,解出 token/cid 之后、`registerOnline` 之前捕获 platform/ip/extra,并把 registerOnline 调用改成带 meta。定位现有:
```ts
      const token = url.searchParams.get('token');
      const cid = url.searchParams.get('clientId');
      if (!token || !cid) throw new Error('missing token/clientId');
```
其后加(仍在 try 内):
```ts
      const platform = url.searchParams.get('platform');
      const extra = url.searchParams.get('extra');
      const xff = req.headers['x-forwarded-for'];
      const lastIp =
        (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0].trim() ||
        req.socket.remoteAddress ||
        null;
```
把 `clientId = cid; projects = v.projectIds; deviceTokenId = v.tokenId;` 之外,新增局部保存 meta——最简做法:把这三个 meta 变量提到 handleConnection 外层 `let`(与 clientId/projects 同级声明),在 try 内赋值,在 try 外的 `registerOnline` 调用处使用。即:
- 顶部声明处加:`let meta: { platform: string | null; lastIp: string | null; extra: string | null };`
- try 内赋值:`meta = { platform, lastIp, extra };`
- 把 `await this.devices.registerOnline(clientId, deviceTokenId);` 改成 `await this.devices.registerOnline(clientId, deviceTokenId, meta);`

> ⚠️ 执行时 `cat ws.gateway.ts` 核对现有 handleConnection 的变量声明块(`let clientId; let projects; let deviceTokenId;`),把 `meta` 加进同一块,确保 try/catch 作用域正确(TS 会要求 try 前声明、catch 后使用的变量确定赋值——meta 只在成功路径用,放在 registerOnline 前即可)。

- [ ] **Step 3: WorkerBootstrap 加 stale 定时任务**

在 `onModuleInit` 末尾追加:
```ts
    await this.maintenance.add(
      'mark-devices-stale',
      {},
      {
        repeat: { every: 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
```

- [ ] **Step 4: MaintenanceProcessor 注入 DevicesService + dispatch**

import + 构造函数加 `DevicesService`:
```ts
import { DevicesService } from '../devices/devices.service';
```
```ts
  constructor(
    private readonly logs: RequestLogsService,
    private readonly config: ConfigService,
    private readonly devices: DevicesService,
  ) {
    super();
  }
```
`process` 加分派:
```ts
    if (job.name === 'mark-devices-stale') return this.markDevicesStale();
```
加私有方法:
```ts
  // presence 对账,把 PG 里 online 但 Redis 已掉线的设备置 stale
  private async markDevicesStale() {
    const stale = await this.devices.markStaleOffline();
    if (stale) this.logger.warn(`stale: ${stale} 台设备 presence 已过期,置 stale`);
    return { stale };
  }
```

- [ ] **Step 5: WorkerModule import DevicesModule**

`imports` 数组加 `DevicesModule`(从 `./application/devices/devices.module`)。

- [ ] **Step 6: build + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -6
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src && git commit -m "feat(2d): capture platform/ip/extra + status on connect; stale-scan maintenance worker"
```
Expected:build 0。

---

## Task 3: 设备列表/详情 API + read/device 权限

**Files:** Modify `devices.controller.ts`, `seed-admin.ts`。

- [ ] **Step 1: DevicesController**(全文替换)

```ts
import { Controller, Get, NotFoundException, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DevicesService } from './devices.service';

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('read', 'device')
  @ApiOperation({ summary: '设备列表(持久态:online/status/platform/last_ip/last_seen)' })
  list() {
    return this.devices.list();
  }

  @Get(':id')
  @RequirePermission('read', 'device')
  @ApiOperation({ summary: '设备详情' })
  async get(@Param('id', ParseIntPipe) id: number) {
    const d = await this.devices.get(id);
    if (!d) throw new NotFoundException('设备不存在');
    return d;
  }
}
```

- [ ] **Step 2: seed-admin 加 read/device 权限**

`ALL_PERMISSIONS` 在 `{ action: 'manage', subject: 'device-token' },` 之后加:
```ts
  { action: 'manage', subject: 'device-token' },
  { action: 'read', subject: 'device' },
];
```

- [ ] **Step 3: build + reseed(补权限)+ 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -3 && node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts 2>&1 | tail -2
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src && git commit -m "feat(2d): devices list/detail API + read/device permission"
```
Expected:build 0;seed 打印「权限 14 条」(13 + read/device)。

---

## Task 4: 冒烟 —— API 设备态 + worker stale 直连冒烟

**Files:** Modify `test/smoke.e2e.js`;Create `src/scripts/device-stale-smoke.ts`;Modify `package.json`。

- [ ] **Step 1: smoke WS 连接带 platform,加设备态断言**

在 Step-1 的 `wsUrl` 拼接里加 `&platform=`:
```js
  const PLATFORM = 'smoke-android';
  const wsUrl = `${B.replace(/^http/, 'ws')}/api/client/ws?token=${encodeURIComponent(regTok.json.token)}&clientId=${CLIENT_ID}&platform=${PLATFORM}`;
```
在「注册 token onlineDeviceCount=1」断言之后、`ws.close()` 之前,加设备列表/详情断言:
```js
  // 2d:设备持久态(设备已在线,应能在 /devices 查到 online + platform)
  const devList = await http('GET', '/devices', null, admin);
  const devRow = (devList.json || []).find((x) => x.clientId === CLIENT_ID);
  assert(!!devRow, '/devices 列表含自注册设备');
  assert(devRow.online === true && devRow.status === 'online', '设备 online=true status=online');
  assert(devRow.platform === PLATFORM, '设备 platform 落库(来自 ?platform)');
  assert(typeof devRow.lastIp === 'string' && devRow.lastIp.length > 0, '设备 last_ip 落库(来自 socket)');
  const devDetail = await http('GET', `/devices/${devRow.id}`, null, admin);
  assert(devDetail.status < 300 && devDetail.json.id === devRow.id, '/devices/:id 详情');
```

- [ ] **Step 2: build + 跑 e2e smoke**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
node_modules/.bin/nest build 2>&1 | tail -2
pkill -f 'node dist/main.js' 2>/dev/null; sleep 1
node dist/main.js > /tmp/api-2d.log 2>&1 &
for i in $(seq 1 25); do curl -s -o /dev/null -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123456"}' && break; sleep 1; done
node test/smoke.e2e.js 2>&1 | tail -50
pkill -f 'node dist/main.js' 2>/dev/null
```
Expected:全 PASS + `=== SMOKE PASSED ===`,含 4 条新设备态断言(列表含设备、online/status、platform、last_ip、详情)。FAIL 别提交。

- [ ] **Step 3: 建 stale 扫描直连冒烟脚本 `src/scripts/device-stale-smoke.ts`**

```ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DevicesService } from '../application/devices/devices.service';
import { devices } from '../application/devices/devices.schema';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';
import { RedisService } from '../infrastructure/redis/redis.service';

// stale 扫描冒烟(无 API 面 → 直连 PG+Redis):种子一台 online 但无 presence 的设备 -> markStaleOffline -> 断言 stale。
// 前置:PG 已迁移。用法: pnpm device:stale:smoke
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);
  const redis = new Redis(cfg.redis);
  // 用真实 service,只喂它需要的 { db } / { client }(不启 Nest DI)
  const svc = new DevicesService(
    { db } as unknown as DbService,
    { client: redis } as unknown as RedisService,
  );

  const CID = 'stale-smoke-probe';
  await db.delete(devices).where(eq(devices.clientId, CID)); // 清残留
  await redis.del(`presence:${CID}`); // 确保无 presence 键(= 实际掉线)
  await db
    .insert(devices)
    .values({ clientId: CID, online: true, status: 'online' });

  let ok = true;
  const check = (c: boolean, m: string) => {
    console.log((c ? 'PASS' : 'FAIL') + ': ' + m);
    if (!c) ok = false;
  };

  const n = await svc.markStaleOffline();
  check(n >= 1, `markStaleOffline 至少置 1 台(实际 ${n})`);

  const [row] = await db
    .select()
    .from(devices)
    .where(eq(devices.clientId, CID))
    .limit(1);
  check(
    !!row && row.online === false && row.status === 'stale',
    'probe 设备被置 online=false status=stale',
  );

  await db.delete(devices).where(eq(devices.clientId, CID)); // 清种子
  await redis.quit();
  await pool.end();
  console.log(
    ok
      ? '\n=== DEVICE STALE SMOKE PASSED ==='
      : '\n=== DEVICE STALE SMOKE FAILED ===',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 4: package.json 加脚本**

在 `"retention:smoke"` 那行之后加:
```json
    "retention:smoke": "ts-node -r tsconfig-paths/register src/scripts/retention-smoke.ts",
    "device:stale:smoke": "ts-node -r tsconfig-paths/register src/scripts/device-stale-smoke.ts"
```
(注意给上一行补逗号。)

- [ ] **Step 5: 跑 stale 冒烟**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/device-stale-smoke.ts 2>&1 | tail -8
```
Expected:`DEVICE STALE SMOKE PASSED`(2 条 PASS)。

- [ ] **Step 6: prettier + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/prettier --write "src/**/*.ts" "test/**/*.js" >/dev/null
cd /Users/lpitiless/Documents/RER0RPC && git add backend/test/smoke.e2e.js backend/src/scripts/device-stale-smoke.ts backend/package.json && git commit -m "test(2d): device state assertions in smoke + stale-scan direct smoke"
```

---

## Task 5: 进度台账 + clientId 待办 + PR

**Files:** Modify `docs/后端进度.md`。

- [ ] **Step 1: 台账 2d → ✅ + #11 收口 + clientId 待办 + 完成记录**

- 总览表 2d 行 ⏹→✅;`#11`(client login platform/extra 落库)状态改 ✅(随 2d 落齐)。
- epic #2 段 2d 前加 ✅;可在 epic 顶部标注「epic 完成」。
- 「已知小遗留」加一条:
```markdown
- **clientId 信任**(2c 引入):`clientId` 为设备自报 query 参数,信任边界=device token,不按 token 隔离。单租户/自有设备下非威胁;若 device token 发不受信任第三方,需硬化(网关处前缀 `{deviceTokenId}:{clientId}`,或恢复老系统 JWT 绑定式 clientId)。用户决策:先只轮询,暂不做。
```
- 完成记录顶部加:
```markdown
### 2026-07-09 · #2/2d 设备持久态 — PR #<n>
- `devices` 落齐 `status`(online/offline/stale)/`platform`/`last_ip`/`extra`;上线从连接捕获 platform(`?platform`)/ip(socket)/extra(`?extra`)+ 置 status=online;优雅下线置 offline。
- stale 扫描 worker(maintenance 队列 `mark-devices-stale`,60s):PG online=true 但 Redis presence 已过期 → 置 offline/stale(`DevicesService.markStaleOffline`,注入 Redis,无 WsModule 环)。
- 设备列表/详情 API `/devices`(`read/device` 权限,→14 条);mirror monitor read 模式。
- 验证:build/lint/format 绿;e2e smoke 加设备态断言(online/status/platform/last_ip/详情)全绿;stale 无 API 面 → 直连冒烟 `device:stale:smoke` 绿。
- device-model epic(#2)**至此完成**(2a rename / 2b device token / 2c 自注册删 client-login / 2d 持久态)。
- 计划:`docs/superpowers/plans/2026-07-09-2d-device-persistent-state.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add docs/后端进度.md && git commit -m "docs(2d): mark device persistent state done + clientId follow-up + completion record" && git push -u origin feat/2d-device-persistent-state && gh pr create --base main --title "feat(2d): 设备持久态(stale 扫描 + 列表/详情 + platform/ip/extra/status)" --body "epic #2 子项 2d(收尾)。devices 落齐持久态列 + stale 对账 worker + 设备只读 API。clientId 信任硬化按用户决策记为待办。计划见 docs/superpowers/plans/2026-07-09-2d-device-persistent-state.md"
```

- [ ] **Step 3:** 回填 PR 号到完成记录,补一提交。

---

## Self-Review

- **Spec 覆盖**(设计 §4/§5/§8 子项4 + 原 #11):`status`(online/offline/stale)✓ platform/last_ip/extra 落齐✓(#11 收口)stale 扫描 worker✓ 列表/详情 API(read/device)✓。
- **DI 无环**:`DevicesService` 只注入 DbService+RedisService(@Global),不碰 WsModule;`WorkerModule` import DevicesModule(worker 无 WsGateway)。
- **类型一致**:`registerOnline(clientId, deviceTokenId, meta?)` 网关调用一致;`markStaleOffline():number` processor 消费一致;`list()/get(id)` controller 调用一致;stale-smoke news up `DevicesService(db, {client})` 与真实构造签名一致。
- **stale 口径**:presence 对账(Redis TTL 即真源),非时间阈值 → 无需 heartbeat 写 last_seen;`last_seen_at` 暂为连接时刻(已知:长连设备 last_seen 偏旧但 status 正确;heartbeat 节流写 last_seen 留后续 nicety)。
- **占位扫描**:无 TODO/TBD;每步完整代码或精确命令。stale-smoke 是 [[api-vs-pg-boundary]] 允许的无 API 面直连冒烟。
- **online bool vs status**:并存(online 供 device-token 在线数查询 + 索引;status 供 3 态展示),registerOnline/markOffline/markStaleOffline 三处保持一致。