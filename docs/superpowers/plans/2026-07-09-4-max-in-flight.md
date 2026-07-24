# #4: maxInFlight 在途并发限流(+ #10 rejected)实现计划

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(推荐)。Steps 用 `- [ ]`。

**Goal:** 单设备在途任务上限:设备 WS 连接自报 `?maxInFlight`(夹 [256,1024]),invoke 派发前查该设备在途数,满则返 `rejected`/429。在途计数走 Redis(跨实例),acquire/release 精确配对。捎带交付 #10 的 `rejected` 状态。

**Architecture:** maxInFlight 存 Redis `device:maxinflight:{clientId}`(TTL 随 presence 刷)+ devices 行 + welcome 回带。在途计数 Redis `device:inflight:{clientId}`:invoke 选到设备后 `tryAcquireSlot`(INCR,超上限 DECR 回退→rejected),派发段 **try/finally** `releaseSlot`(DECR)保证每 acquire 一 release;连接时 `resetInFlight` 清残留防泄漏。

**Tech Stack:** NestJS 11 · ioredis(INCR/DECR 原子)· drizzle。

## Global Constraints
- 已在分支 `feat/4-max-in-flight`。功能分支 → PR → 合并。
- 提交/PR 前(`backend/`,**不用 `pnpm <script>`**,直接 `node_modules/.bin/{...}`):build+lint+format 全过。
- **夹取**:`clamp(raw) = min(1024, max(256, floor(Number(raw))))`;非数/缺省 → **512**。
- **计数正确性**:`tryAcquireSlot` 用原子 INCR(超则自减回退);派发后 `releaseSlot` 放 finally,error/unavailable/success/timeout 全覆盖;`releaseSlot` 兜底不为负;连接 `resetInFlight` 限泄漏在一 session 内。
- **范围**:单设备满即 `rejected`(选到的设备满就拒;多设备"轮询跳过满设备"的组饱和精确判 = 延后 refinement,单设备项已精确)。

## File Structure
- Modify `src/application/devices/devices.schema.ts` — 加 `max_in_flight`。
- Modify `src/infrastructure/ws/presence.service.ts` — maxInFlight/inflight 键方法 + offline 清理。
- Modify `src/infrastructure/ws/ws.gateway.ts` — 连接读 ?maxInFlight/set/reset、心跳刷、welcome 回带、传 registerOnline。
- Modify `src/application/devices/devices.service.ts` — registerOnline 收 maxInFlight。
- Modify `src/application/rpc/rpc.service.ts` — 派发前 acquire→rejected、finally release。
- Create `src/scripts/max-inflight-smoke.ts` + `package.json` 脚本。
- Modify `test/smoke.e2e.js`。
- 新迁移 `0006_*.sql`。

---

## Task 1: devices.max_in_flight + 迁移

- [ ] **Step 1: devices.schema 加列**(`extra` 之后)

```ts
    extra: text('extra'),
    maxInFlight: integer('max_in_flight'),
    description: varchar('description', { length: 255 }),
```
> `integer` 已 import(2b 加的 device_token_id)。可空(旧行/未上报为 NULL)。

- [ ] **Step 2: 生成+应用+reseed+build**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend
node_modules/.bin/drizzle-kit generate
grep -nE 'ADD COLUMN "max_in_flight"' drizzle/0006_*.sql
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/migrate.ts
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts 2>&1 | tail -1
node_modules/.bin/nest build 2>&1 | tail -3
```
Expected:`0006` 有 `ADD COLUMN "max_in_flight"`(非交互);迁移完成;build 0。

- [ ] **Step 3: 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add backend/src/application/devices/devices.schema.ts backend/drizzle && git commit -m "feat(4): devices.max_in_flight column + migration"
```

---

## Task 2: PresenceService 计数方法 + 网关自报接线

**Files:** `presence.service.ts`, `ws.gateway.ts`, `devices.service.ts`。

- [ ] **Step 1: PresenceService 加常量 + maxInFlight/inflight 方法**

顶部常量区(`PRESENCE_TTL` 旁)加:
```ts
const MAX_IN_FLIGHT_DEFAULT = 512;
const MAX_IN_FLIGHT_MIN = 256;
const MAX_IN_FLIGHT_MAX = 1024;
```
类内加:
```ts
  // 夹取自报值到 [256,1024];非数/缺省 → 512
  clampMaxInFlight(raw: unknown): number {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return MAX_IN_FLIGHT_DEFAULT;
    return Math.min(MAX_IN_FLIGHT_MAX, Math.max(MAX_IN_FLIGHT_MIN, n));
  }

  // 写/刷设备 maxInFlight(TTL 随 presence)
  async setMaxInFlight(clientId: string, max: number) {
    await this.r.set(`device:maxinflight:${clientId}`, String(max), 'EX', PRESENCE_TTL);
  }
  async getMaxInFlight(clientId: string): Promise<number> {
    const v = await this.r.get(`device:maxinflight:${clientId}`);
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : MAX_IN_FLIGHT_DEFAULT;
  }

  // 连接时清在途计数(限泄漏在一次 session 内)
  async resetInFlight(clientId: string) {
    await this.r.del(`device:inflight:${clientId}`);
  }
  // 占一个在途槽:INCR;若超上限自减回退返 false
  async tryAcquireSlot(clientId: string, max: number): Promise<boolean> {
    const n = await this.r.incr(`device:inflight:${clientId}`);
    if (n > max) {
      await this.r.decr(`device:inflight:${clientId}`);
      return false;
    }
    return true;
  }
  // 释放一个在途槽(兜底不为负)
  async releaseSlot(clientId: string) {
    const n = await this.r.decr(`device:inflight:${clientId}`);
    if (n < 0) await this.r.set(`device:inflight:${clientId}`, '0');
  }
```
并在 `offline(...)` 里加清理(下线清干净):
```ts
  async offline(clientId: string, projectIds: number[]) {
    await this.r.del(`presence:${clientId}`);
    await this.r.del(`device:maxinflight:${clientId}`);
    await this.r.del(`device:inflight:${clientId}`);
    for (const gid of projectIds) {
      await this.r.srem(`project:clients:${gid}`, clientId);
    }
  }
```
`refresh(clientId)` 也刷 maxInFlight TTL——改成收 max 参数或网关侧另调 setMaxInFlight(见 Step 2 心跳)。这里 `refresh` 不改。

- [ ] **Step 2: ws.gateway 连接自报 + 心跳刷 + welcome + registerOnline**

`ClientSocket` 类型加 `_maxInFlight?: number`。`handleConnection` try 内解出 token/cid 后加:
```ts
      const maxInFlight = this.presence.clampMaxInFlight(
        url.searchParams.get('maxInFlight'),
      );
```
并把它带进 meta(与 platform 同级)+ 存 socket:成功路径 `socket._maxInFlight = maxInFlight;`。`registry.register` 后那段改为:
```ts
      await this.registry.register(clientId, socket);
      await this.devices.registerOnline(clientId, deviceTokenId, {
        platform,
        lastIp,
        extra,
        maxInFlight,
      });
      await this.presence.online(clientId, projects);
      await this.presence.setMaxInFlight(clientId, maxInFlight);
      await this.presence.resetInFlight(clientId);
```
welcome 回带:`this.send(socket, { type: 'welcome', clientId, projects, maxInFlight });`
心跳分支(`case 'heartbeat'`)在 `presence.refresh` 后加刷 maxInFlight TTL:
```ts
          if (socket._clientId) {
            await this.presence.refresh(socket._clientId);
            if (socket._maxInFlight)
              await this.presence.setMaxInFlight(socket._clientId, socket._maxInFlight);
            await this.registry.refreshSession(socket._clientId);
          }
```
> `meta`/`maxInFlight` 变量在 try 内声明、成功路径用;`cat ws.gateway.ts` 核对 meta 声明块(2d 加的 `let meta`),把 maxInFlight 合进去(或直接在成功路径构造 meta 时带上)。下线走 `presence.offline`(已含清理),无需网关额外清。

- [ ] **Step 3: DevicesService.registerOnline 收 maxInFlight**

`DeviceMeta` 接口加 `maxInFlight?: number | null;`;`registerOnline` 的 `base`/insert/update 里带上 `maxInFlight: meta.maxInFlight ?? null`(与 lastIp 同处理,每次连接刷)。

- [ ] **Step 4: build + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -5
cd /Users/lpitiless/Documents/R2RPC && git add backend/src && git commit -m "feat(4): device self-report maxInFlight on WS connect + Redis inflight counter methods"
```

---

## Task 3: invoke 派发限流(rejected/429)

**Files:** `rpc.service.ts`。

- [ ] **Step 1: 选到设备后 acquire,派发段 try/finally release**

在设备选择 try/catch 块**之后**(现 `const job = {...}` 之前,clientId 已确定非空)插入 acquire + 用 try/finally 包住从 job 到最终 return 的整段。即把现有从 `const job = {` 到 timeout catch 结束的整段,改成:
```ts
    // 在途并发限流:占一个槽,满则 rejected/429
    const maxInFlight = await this.presence.getMaxInFlight(clientId);
    if (!(await this.presence.tryAcquireSlot(clientId, maxInFlight))) {
      return this.fail(
        p,
        requestId,
        clientId,
        startedAt,
        'rejected',
        429,
        '设备在途任务已满',
      );
    }
    try {
      const job = {
        type: 'job',
        requestId,
        project: p.project,
        action: p.action,
        payload: p.payload,
        timeoutSeconds,
      };
      // ...(registerWaiter / markWaiting / dispatchJob / 各 fail 分支 / await resultP / 成功 return / timeout catch —— 原样保留,整体移进本 try)...
    } finally {
      // 每次 acquire 精确配对一次 release(error/unavailable/success/timeout 全覆盖)
      await this.presence.releaseSlot(clientId).catch(() => undefined);
    }
```
> ⚠️ 关键:acquire 成功后**所有**返回路径(dispatch error、unavailable、成功 resp、timeout)都在这 try 内,finally 保证 release 恰好一次。acquire 失败(rejected)在 try 之前 return,不进 finally,不 release(因为没 acquire 成功)。`cat rpc.service.ts` 精确定位现有 `const job` 到方法末尾,整体缩进进 try。

- [ ] **Step 2: build + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -6
cd /Users/lpitiless/Documents/R2RPC && git add backend/src/application/rpc/rpc.service.ts && git commit -m "feat(4): invoke acquires inflight slot, rejects (429) when device saturated; releases in finally"
```

---

## Task 4: 冒烟(e2e plumbing + 直连 Redis 计数)

**Files:** `test/smoke.e2e.js`;Create `src/scripts/max-inflight-smoke.ts`;`package.json`。

- [ ] **Step 1: e2e 加 welcome.maxInFlight + /devices.maxInFlight 断言**

smoke 连接段:WS url 加 `&maxInFlight=600`;welcome 断言后加:
```ts
  assert(
    typeof welcomeMsg.maxInFlight === 'number' && welcomeMsg.maxInFlight >= 256 && welcomeMsg.maxInFlight <= 1024,
    'welcome 回带 maxInFlight(夹 [256,1024])',
  );
```
设备态断言区(devRow 那块)加:
```ts
  assert(devRow.maxInFlight === 600, '设备 maxInFlight 落库(自报 600 在区间内)');
```
> 600 在 [256,1024] 内,夹取后 = 600。

- [ ] **Step 2: 建 `src/scripts/max-inflight-smoke.ts`**(直连 Redis 测计数逻辑,无 API)

```ts
import Redis from 'ioredis';
import { PresenceService } from '../infrastructure/ws/presence.service';
import { ConfigService } from '../infrastructure/config/config.service';
import { RedisService } from '../infrastructure/redis/redis.service';

// 在途限流冒烟(无 API 面 → 直连 Redis):tryAcquireSlot 到上限即拒,release 后可再占。
async function main() {
  const cfg = new ConfigService();
  const redis = new Redis({
    host: cfg.redis.host,
    port: cfg.redis.port,
    password: cfg.redis.password ?? undefined,
    db: cfg.redis.db,
  });
  const svc = new PresenceService({ client: redis } as unknown as RedisService);

  const CID = 'maxinflight-smoke-probe';
  const MAX = 3; // 直接用小值测逻辑(clamp 只在网关入口,这里直接喂 max)
  await svc.resetInFlight(CID);

  let ok = true;
  const check = (c: boolean, m: string) => {
    console.log((c ? 'PASS' : 'FAIL') + ': ' + m);
    if (!c) ok = false;
  };

  const a1 = await svc.tryAcquireSlot(CID, MAX);
  const a2 = await svc.tryAcquireSlot(CID, MAX);
  const a3 = await svc.tryAcquireSlot(CID, MAX);
  check(a1 && a2 && a3, '占满 3 个槽(max=3)');
  const a4 = await svc.tryAcquireSlot(CID, MAX);
  check(a4 === false, '第 4 个超上限被拒(rejected)');
  await svc.releaseSlot(CID);
  const a5 = await svc.tryAcquireSlot(CID, MAX);
  check(a5 === true, 'release 一个后可再占');
  // 兜底不为负
  await svc.resetInFlight(CID);
  await svc.releaseSlot(CID);
  const a6 = await svc.tryAcquireSlot(CID, MAX);
  check(a6 === true, 'release 到负后兜底 0,仍可占');

  await svc.resetInFlight(CID);
  await redis.quit();
  console.log(ok ? '\n=== MAXINFLIGHT SMOKE PASSED ===' : '\n=== MAXINFLIGHT SMOKE FAILED ===');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```
> clamp 只在网关入口做;直连测直接喂 `max=3` 验证 acquire/release 逻辑(clamp 逻辑另由 e2e 的 welcome 断言覆盖)。

- [ ] **Step 3: package.json 加脚本**

`"metrics:smoke"` 后加(补逗号):
```json
    "metrics:smoke": "ts-node -r tsconfig-paths/register src/scripts/metrics-smoke.ts",
    "maxinflight:smoke": "ts-node -r tsconfig-paths/register src/scripts/max-inflight-smoke.ts"
```

- [ ] **Step 4: 跑两个冒烟**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/max-inflight-smoke.ts 2>&1 | tail -8
node_modules/.bin/nest build 2>&1 | tail -2
pkill -f 'node dist/main.js' 2>/dev/null; sleep 1
node dist/main.js > /tmp/api-4.log 2>&1 &
for i in $(seq 1 25); do curl -s -o /dev/null -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123456"}' && break; sleep 1; done
node test/smoke.e2e.js 2>&1 | tail -20
pkill -f 'node dist/main.js' 2>/dev/null
```
Expected:`MAXINFLIGHT SMOKE PASSED`(4 断言);e2e `SMOKE PASSED`(含 welcome.maxInFlight + devRow.maxInFlight)。

- [ ] **Step 5: prettier + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/prettier --write "src/**/*.ts" "test/**/*.js" >/dev/null
cd /Users/lpitiless/Documents/R2RPC && git add backend/src/scripts/max-inflight-smoke.ts backend/package.json backend/test/smoke.e2e.js && git commit -m "test(4): inflight-slot direct smoke + welcome/devices maxInFlight e2e assertions"
```

---

## Task 5: 进度台账 + PR

**Files:** `docs/后端进度.md`。

- [ ] **Step 1: 台账 #4 → ✅ + #10 → ✅(rejected 交付)+ 完成记录**

- 总览表 `#4` ⬜→✅;`#10` 状态 → ✅(rejected 随 #4 交付)。
- #4/#10 段落标注完成。
- 完成记录顶部加:
```markdown
### 2026-07-09 · #4 maxInFlight 在途并发限流(+ #10 rejected) — PR #<n>
- 设备 WS 连接 `?maxInFlight` 自报,服务端夹到 `[256,1024]`(默认 512),存 Redis `device:maxinflight:{cid}`(TTL 随 presence 刷)+ devices 行 + welcome 回带。迁移 `0006`。
- 在途计数 Redis `device:inflight:{cid}`:invoke 选到设备后 `tryAcquireSlot`(INCR,超上限自减回退→`rejected`/429),派发段 try/finally `releaseSlot`(DECR)保证 error/unavailable/success/timeout 全覆盖恰好一次;连接 `resetInFlight`、下线 offline 清理防泄漏。
- **#10 rejected 状态**随本项交付(队列满)。多设备"轮询跳过满设备"的组饱和精确判 = 延后 refinement(单设备项已精确;cap 256 极少触发)。
- 验证:build/lint/format 绿;直连冒烟 `maxinflight:smoke`(acquire/release 4 断言)绿;e2e smoke welcome/devices maxInFlight 断言绿。
- 计划:`docs/superpowers/plans/2026-07-09-4-max-in-flight.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add docs/后端进度.md && git commit -m "docs(4): mark maxInFlight + rejected done" && git push -u origin feat/4-max-in-flight && gh pr create --base main --title "feat(4): maxInFlight 在途并发限流(+ #10 rejected)" --body "设备自报 maxInFlight[256,1024] + invoke 在途限流(满则 rejected/429)+ Redis 计数 acquire/release 精确配对。计划见 docs/superpowers/plans/2026-07-09-4-max-in-flight.md"
```

- [ ] **Step 3:** 回填 PR 号,补一提交。

---

## Self-Review
- **来源**:设备自报 `?maxInFlight` 夹 [256,1024] 默认512(用户决策,对齐老系统自报)。
- **计数正确性**:tryAcquireSlot 原子 INCR + 超限自减;release 在 finally 覆盖所有 acquire 后路径恰好一次;负值兜底;连接 reset + 下线 offline 清理限泄漏。
- **rejected/#10**:满 → fail('rejected',429) 落 request_logs.status → 指标归 failed;#10 队列满部分交付。
- **类型一致**:`clampMaxInFlight`/`get/set/reset/tryAcquire/release` 与网关/rpc 调用一致;registerOnline meta 加 maxInFlight;welcome 带 maxInFlight。
- **TTL**:maxinflight 键随 presence(30s)刷(连接 set + 心跳 re-set);过期后 invoke getMaxInFlight 回默认512(设备离线时不派发,无碍)。
- **迁移**:0006 纯 ADD COLUMN 非交互。
