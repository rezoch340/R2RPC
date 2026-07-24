# 2c: 设备自注册 + 删 client-login 实现计划

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 设备用 **device token** 自注册上线(WS `?token=<device-token>&clientId=<自生成>`),继承该 token 的 project;**彻底删掉旧 client-login**(clients/client_groups/POST clients/api login/ClientService/Controller/Module);顺带补 2b 延后项(device-token WS 校验 cache-aside + revoke/delete 缓存失效 + `devices.device_token_id` 索引)。

**Architecture:** WS 网关鉴权从「client JWT」换成「device token(cache-aside 校验,fail-open)」→ 取 token 的 projectIds → `upsert devices(client_id, device_token_id, online, last_seen) + presence.online(clientId, projectIds) + welcome`。下线置 `devices.online=false` + presence.offline。device token 校验缓存照 `AccessTokenGuard` 既有模式(sha256 key、正/负缓存、revoke/delete 同步删)。invoke/access-token 调用方侧不动。

**Tech Stack:** NestJS 11 · drizzle-orm 0.45 · ws(`@nestjs/platform-ws`)· ioredis · drizzle-kit 0.31。

## Global Constraints

- **不直接提交 main。** 已在分支 `feat/2c-device-self-register`。功能分支 → PR → 合并。
- **提交/PR 前**(从 `backend/` 跑,**不要用 `pnpm <script>`**——本机 pnpm 包装器会跑一个失败的 `pnpm install` 把脚本弄挂;直接调 `node_modules/.bin/{nest build,eslint,prettier,drizzle-kit,ts-node}`):`nest build`(0)+ `eslint "{src,apps,libs,test}/**/*.ts" --fix` + `prettier --write "src/**/*.ts" "test/**/*.js"`。
- **破坏式迁移已批**([[backend-progress-tracker]]):drop `clients`/`client_groups` 直接删表,dev 库 migrate 掉即可,demo 数据 seed 重建。
- **冷热/缓存准则**([[redis-cache-invalidation]]):device-token 校验走 cache-aside(fail-open,redis 异常当未命中回落 DB);revoke/删/(未来改)**同步删缓存**。WS 生命周期(上线/下线)对 presence 是**主动写**(它是 socket 持有方)。
- **RedisModule + DbModule 是 `@Global`**(已核实):`DeviceTokenService`/`WsGateway`/`DevicesService` 可直接注入 `RedisService`/`DbService`,**无需 import 对应 module**。
- **WsModule import DeviceTokenModule + DevicesModule 无环**(已核实,WsModule 是 infra、这两个 app 模块不反向依赖 WsModule)。
- **本子项不落 platform/last_ip/extra**(设计 §8 归 2d):`devices` 上线只写 `client_id/device_token_id/online/last_seen_at`。**决策(可评审否决):** 若你要 2c 就落 IP/platform,说一声——需 2d 的列提前到本子项。

---

## File Structure

- **改** `src/application/device-token/device-token.service.ts` — 加 `findByToken`/`validateForConnect`(cache-aside)+ 注入 RedisService;revoke/delete 落缓存删(替换 2b 的两个 `ponytail:` 标记)。
- **改** `src/application/devices/devices.service.ts` — 加 `registerOnline`/`markOffline`;`devices.module.ts` exports DevicesService。
- **改** `src/infrastructure/ws/ws.gateway.ts` — device-token 鉴权 + upsert devices;`ws.module.ts` — imports 换。
- **改** `src/application/devices/devices.schema.ts` — 加 `device_token_id` 索引(2b 延后项)。
- **删** 整个 `src/application/client/`(7 文件)。
- **改** `src/app.module.ts`(去 ClientModule)、`src/application/projects/projects.service.ts`(删 `projectsOfClient` + clientGroups import)、`src/scripts/seed-admin.ts`(去 client 权限 + demo 设备 seed + clients/clientGroups import)。
- **新迁移** `0002_*.sql`(drop clients + client_groups + create device_token_id 索引)。
- **改** `test/smoke.e2e.js` — client-login 流程换成 device-token 自注册。

---

## Task 1: DeviceTokenService — WS 校验(cache-aside)+ revoke/delete 缓存失效

**Files:** Modify `src/application/device-token/device-token.service.ts`

**Interfaces:**
- Produces:`DeviceTokenService.validateForConnect(plain): Promise<{ tokenId: number; projectIds: number[] } | null>`(供 Task 2 网关)。
- Consumes:`RedisService`(@Global),`deviceTokens`/`deviceTokenProjects`(2b)。

- [ ] **Step 1: 加 import + 常量 + 类型**(在文件顶部 import 区加,类外加常量/类型)

顶部 import 增加:
```ts
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../../infrastructure/redis/redis.service';
```
(`randomBytes` 原已 import,保留;若已有 `createHash` 勿重复。)

在 `@Injectable()` 上方(imports 之后)加:
```ts
const WS_TOKEN_POSITIVE_TTL = 60; // 秒
const WS_TOKEN_NEGATIVE_TTL = 10; // 秒(负缓存,防伪造 token 打 DB)

type CachedDeviceToken = {
  id: number;
  status: string;
  expiresAt: Date | string | null;
  projectIds: number[];
};
```

- [ ] **Step 2: 构造函数注入 RedisService**

```ts
  constructor(
    private readonly dbService: DbService,
    private readonly projects: ProjectsService,
    private readonly redis: RedisService,
  ) {}
```

- [ ] **Step 3: 加 `findByToken` + `validateForConnect` + 缓存读写**(加到类内,`delete()` 之后)

```ts
  private wsCacheKey(plain: string) {
    return `ws:devtoken:${createHash('sha256').update(plain).digest('hex')}`;
  }

  // DB 查:明文 token → 记录 + projectIds(供 WS 校验回落)
  async findByToken(plain: string): Promise<CachedDeviceToken | null> {
    const [row] = await this.db
      .select()
      .from(deviceTokens)
      .where(alive(deviceTokens, eq(deviceTokens.token, plain)))
      .limit(1);
    if (!row) return null;
    const projectRows = await this.db
      .select({ projectId: deviceTokenProjects.projectId })
      .from(deviceTokenProjects)
      .where(eq(deviceTokenProjects.tokenId, row.id));
    return {
      id: row.id,
      status: row.status,
      expiresAt: row.expiresAt,
      projectIds: projectRows.map((r) => r.projectId),
    };
  }

  // WS 连接校验(cache-aside,fail-open):有效返回 {tokenId, projectIds},失败返回 null
  async validateForConnect(
    plain: string,
  ): Promise<{ tokenId: number; projectIds: number[] } | null> {
    const key = this.wsCacheKey(plain);
    let t = await this.readCache(key);
    if (t === undefined) {
      t = await this.findByToken(plain);
      await this.writeCache(key, t);
    }
    if (!t) return null;
    if (t.status !== 'active') return null;
    if (t.expiresAt && new Date(t.expiresAt) < new Date()) return null;
    return { tokenId: t.id, projectIds: t.projectIds };
  }

  // 命中正缓存→记录;命中负缓存→null;未命中/redis 异常→undefined(回落 DB)
  private async readCache(
    key: string,
  ): Promise<CachedDeviceToken | null | undefined> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as {
        notFound?: boolean;
      } & Partial<CachedDeviceToken>;
      if (parsed.notFound) return null;
      return parsed as CachedDeviceToken;
    } catch {
      return undefined;
    }
  }

  private async writeCache(
    key: string,
    t: CachedDeviceToken | null,
  ): Promise<void> {
    try {
      if (t === null) {
        await this.redis.client.set(
          key,
          JSON.stringify({ notFound: true }),
          'EX',
          WS_TOKEN_NEGATIVE_TTL,
        );
      } else {
        await this.redis.client.set(
          key,
          JSON.stringify(t),
          'EX',
          WS_TOKEN_POSITIVE_TTL,
        );
      }
    } catch {
      // fail-open:缓存写失败不影响校验
    }
  }
```

- [ ] **Step 4: revoke/delete 落缓存删**(替换 2b 的两个 `// ponytail:` 注释)

`revoke()`:把 `// ponytail: ...` 那行换成——用返回行的明文 token 删缓存:
```ts
    if (!row) throw new NotFoundException('Device token 不存在');
    await this.delWsCache(row.token);
    return row;
```
`delete()`:`softDelete` 返回行含 token,删缓存:
```ts
    if (rows.length === 0) throw new NotFoundException('Device token 不存在');
    const row = rows[0] as { token?: string };
    if (row.token) await this.delWsCache(row.token);
    return { deleted: true };
```
并加私有方法:
```ts
  private async delWsCache(plain: string): Promise<void> {
    try {
      await this.redis.client.del(this.wsCacheKey(plain));
    } catch {
      // fail-open:缓存删失败不阻断撤销/删除,最长 TTL 后自然过期
    }
  }
```

- [ ] **Step 5: build**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -5
```
Expected: 退出 0。

- [ ] **Step 6: 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src/application/device-token/device-token.service.ts && git commit -m "feat(2c): device-token WS validation cache-aside + revoke/delete cache invalidation"
```

---

## Task 2: DevicesService upsert + WS 网关改 device-token 鉴权

**Files:** Modify `src/application/devices/devices.service.ts`, `src/application/devices/devices.module.ts`, `src/infrastructure/ws/ws.gateway.ts`, `src/infrastructure/ws/ws.module.ts`

**Interfaces:**
- Consumes:Task 1 `DeviceTokenService.validateForConnect`;`ConnectionRegistry.{register,unregister,refreshSession,handleResult}`(不变);`PresenceService.{online,offline,refresh}`。
- Produces:`DevicesService.{registerOnline,markOffline}`;WS `/api/client/ws?token&clientId` device-token 鉴权。

- [ ] **Step 1: DevicesService 加 upsert/offline**(替换空 stub 全文)

```ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { alive } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { devices } from './devices.schema';

@Injectable()
export class DevicesService {
  constructor(private readonly dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  // 设备上线:按 client_id upsert(revive alive 行 / 新建),记 device_token_id + online + last_seen
  async registerOnline(clientId: string, deviceTokenId: number): Promise<void> {
    const [existing] = await this.db
      .select({ id: devices.id })
      .from(devices)
      .where(alive(devices, eq(devices.clientId, clientId)))
      .limit(1);
    if (existing) {
      await this.db
        .update(devices)
        .set({ deviceTokenId, online: true, lastSeenAt: new Date() })
        .where(eq(devices.id, existing.id));
    } else {
      await this.db
        .insert(devices)
        .values({ clientId, deviceTokenId, online: true, lastSeenAt: new Date() });
    }
  }

  // 设备下线:置 online=false(权威冷持久;presence 热镜像由 WS 生命周期另清)
  async markOffline(clientId: string): Promise<void> {
    await this.db
      .update(devices)
      .set({ online: false })
      .where(alive(devices, eq(devices.clientId, clientId)));
  }
}
```

- [ ] **Step 2: DevicesModule export DevicesService**(全文替换)

```ts
import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
```

- [ ] **Step 3: WsModule imports 换**(全文替换)

去掉 JwtModule(网关不再用 JWT),import DeviceTokenModule + DevicesModule:
```ts
import { Module } from '@nestjs/common';
import { DeviceTokenModule } from '../../application/device-token/device-token.module';
import { DevicesModule } from '../../application/devices/devices.module';
import { ClusterBus } from './cluster-bus.service';
import { ConnectionRegistry } from './connection.registry';
import { PresenceService } from './presence.service';
import { WsGateway } from './ws.gateway';

@Module({
  imports: [DeviceTokenModule, DevicesModule],
  providers: [WsGateway, PresenceService, ConnectionRegistry, ClusterBus],
  exports: [PresenceService, ConnectionRegistry],
})
export class WsModule {}
```
> ⚠️ 执行前先 `cat src/infrastructure/ws/ws.module.ts` 核对现有 providers/exports 与上面一致(尤其 ClusterBus 是否在 providers);若现有还有别的 provider,合并进来,别丢。

- [ ] **Step 4: WsGateway 改 device-token 鉴权**(全文替换)

```ts
import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { IncomingMessage } from 'node:http';
import type { RawData, WebSocket } from 'ws';
import { DeviceTokenService } from '../../application/device-token/device-token.service';
import { DevicesService } from '../../application/devices/devices.service';
import { ConnectionRegistry } from './connection.registry';
import { PresenceService } from './presence.service';

// socket 上挂的会话上下文(设备可属多 project)
type ClientSocket = WebSocket & { _clientId?: string; _projects?: number[] };

// 设备常驻连接网关(路径 /api/client/ws)。鉴权:device token(?token) + 自生成 clientId(?clientId)。
@WebSocketGateway({ path: '/api/client/ws' })
export class WsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('WsGateway');

  constructor(
    private readonly deviceTokens: DeviceTokenService,
    private readonly devices: DevicesService,
    private readonly presence: PresenceService,
    private readonly registry: ConnectionRegistry,
  ) {}

  async handleConnection(socket: ClientSocket, req: IncomingMessage) {
    let clientId: string;
    let projects: number[];
    let deviceTokenId: number;
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      const cid = url.searchParams.get('clientId');
      if (!token || !cid) throw new Error('missing token/clientId');
      const v = await this.deviceTokens.validateForConnect(token);
      if (!v) throw new Error('invalid device token');
      clientId = cid;
      projects = v.projectIds;
      deviceTokenId = v.tokenId;
    } catch {
      this.logger.warn('WS 鉴权失败,关闭连接');
      socket.close(4001, 'unauthorized');
      return;
    }

    socket._clientId = clientId;
    socket._projects = projects;
    try {
      // redis/db 抖动时直接关连接,设备会自动重连等基础设施恢复
      await this.registry.register(clientId, socket);
      await this.devices.registerOnline(clientId, deviceTokenId);
      await this.presence.online(clientId, projects);
    } catch (e) {
      this.logger.warn(`WS 上线失败(基础设施不可用): ${(e as Error).message}`);
      socket.close(4503, 'infra unavailable');
      return;
    }
    socket.on('message', (data: RawData) => {
      const raw = Array.isArray(data)
        ? Buffer.concat(data).toString()
        : Buffer.isBuffer(data)
          ? data.toString()
          : Buffer.from(data).toString();
      void this.onMessage(socket, raw).catch(() => undefined);
    });
    this.send(socket, { type: 'welcome', clientId, projects });
    this.logger.log(`设备上线: ${clientId}@[${projects.join(',')}]`);
  }

  async handleDisconnect(socket: ClientSocket) {
    const clientId = socket._clientId;
    const projects = socket._projects;
    if (clientId) {
      try {
        const wasOwner = await this.registry.unregister(clientId, socket);
        if (wasOwner && projects) {
          await this.presence.offline(clientId, projects);
          await this.devices.markOffline(clientId);
        }
        this.logger.log(`设备下线: ${clientId}`);
      } catch (e) {
        this.logger.warn(`WS 下线清理失败: ${(e as Error).message}`);
      }
    }
  }

  private async onMessage(socket: ClientSocket, raw: string) {
    try {
      let msg: { type?: string; requestId?: string; [k: string]: unknown };
      try {
        msg = JSON.parse(raw) as {
          type?: string;
          requestId?: string;
          [k: string]: unknown;
        };
      } catch {
        return;
      }
      switch (msg.type) {
        case 'heartbeat':
          if (socket._clientId) {
            await this.presence.refresh(socket._clientId);
            await this.registry.refreshSession(socket._clientId);
          }
          this.send(socket, { type: 'heartbeatAck' });
          break;
        case 'result': {
          const outcome = await this.registry.handleResult(
            msg.requestId ?? '',
            socket._clientId ?? '',
            msg,
          );
          this.send(socket, {
            type: 'resultAck',
            requestId: msg.requestId,
            outcome,
          });
          break;
        }
        default:
          break;
      }
    } catch (e) {
      this.logger.warn(`ws message 处理失败: ${(e as Error).message}`);
    }
  }

  private send(socket: WebSocket, obj: unknown) {
    if (socket.readyState === 1) socket.send(JSON.stringify(obj));
  }
}
```

> 说明:去掉了 `extractToken`(改为直接在 handleConnection 里解 URL)与 JwtService;`onMessage`/`send` 逻辑不变。

- [ ] **Step 5: build**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -8
```
Expected: 退出 0。(旧 client-login 端点此刻仍在但已成孤儿——其 JWT wsUrl 连 WS 会被当 device token 校验失败 close 4001;Task 3 删掉它。)

- [ ] **Step 6: 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src/application/devices backend/src/infrastructure/ws && git commit -m "feat(2c): WS gateway device-token auth + devices online upsert"
```

---

## Task 3: 删 client-login + drop 表 + 清引用 + 迁移

**Files:** Delete `src/application/client/` (7 files);Modify `src/app.module.ts`, `src/application/projects/projects.service.ts`, `src/scripts/seed-admin.ts`, `src/application/devices/devices.schema.ts`;Generate `drizzle/0002_*.sql`。

- [ ] **Step 1: 删 client 目录**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && git rm -r src/application/client
```

- [ ] **Step 2: app.module 去 ClientModule**

删 `import { ClientModule } from './application/client/client.module';` 与 imports 数组里的 `ClientModule,` 一行。

- [ ] **Step 3: projects.service 删 `projectsOfClient` + clientGroups import**

删掉顶部 `import { clientGroups } from '../client/client-groups.schema';`,并删掉整个 `projectsOfClient(clientDbId)` 方法(约方法体最后一段,连同其上方注释 `// 查设备所属的所有 project...`)。删后 `ProjectsService` 只剩 `list/findByName/create/remove/idByName`。

- [ ] **Step 4: seed-admin 清 client 相关**

- 删顶部 import(两行):`import { clients } ...` 与 `import { clientGroups } ...`。
- `ALL_PERMISSIONS` 删两行:`{ action: 'read', subject: 'client' },` 与 `{ action: 'create', subject: 'client' },`。
- 删 `DEMO_CLIENT_ID` / `DEMO_CLIENT_SECRET` 两个常量。
- 删整块 demo 设备 seeding(从 `// demo 设备账号 dev-001...` 注释起,含 `.insert(clients)`、`const [device] = ...`、`for (const name of DEMO_PROJECTS) { ... insert(clientGroups) ... }`、以及那句 `console.log('demo 设备已就绪...')`,到该块结束)。保留 `DEMO_PROJECTS` 的 project seeding 块(projects 仍要 seed)。

> 执行前 `cat src/scripts/seed-admin.ts` 定位准确行;删后 seed 只做:admin 用户 + demo projects + 权限全集 + operator 角色。

- [ ] **Step 5: devices.schema 加 `device_token_id` 索引**(2b 延后项)

在 import 区确保有 `index`,并给表第二参加索引(与现有 uniqueIndex 并列):
```ts
import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
```
```ts
  (t) => [
    uniqueIndex('devices_client_id_uq')
      .on(t.clientId)
      .where(sql`${t.deletedAt} IS NULL`),
    index('devices_device_token_id_idx').on(t.deviceTokenId),
  ],
```

- [ ] **Step 6: build(验证引用全清干净)**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -8
```
Expected: 退出 0。若报找不到 client/* 或 clientGroups/clients/projectsOfClient,回到对应 Step 补删。兜底 grep 应为空:
```bash
grep -rniIE "application/client/|ClientModule|ClientService|ClientController|projectsOfClient|clientGroups|CreateClientDto|ClientLoginDto" src
```

- [ ] **Step 7: 生成迁移(drop 两表 + 加索引)+ 应用 + reseed**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/drizzle-kit generate
grep -nE 'DROP TABLE|device_token_id_idx' drizzle/0002_*.sql
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/migrate.ts
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts
node_modules/.bin/drizzle-kit generate
```
Expected: `0002_*.sql` 含 `DROP TABLE "client_groups"`、`DROP TABLE "clients"`、`CREATE INDEX "devices_device_token_id_idx"`;**无交互 prompt**(纯 drop + 加索引,无 rename 歧义);migrate `迁移完成`;seed 打印「权限 13 条」(15 − read/create client);末次 generate `No schema changes`。

- [ ] **Step 8: 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add -A && git commit -m "feat(2c): delete client-login (drop clients/client_groups) + devices device_token_id index"
```

---

## Task 4: 重写 smoke —— device-token 自注册闭环

**Files:** Modify `test/smoke.e2e.js`

- [ ] **Step 1: 换掉 client-login 上线段**

把「建组 + 建设备账号 + client login + `new WebSocket(cl.json.wsUrl)`」那一段(从 `// 建 project + 建设备账号...` 到取得 `ws` + welcome 之前)整体替换为:先建一枚注册用 device token,再手拼 WS url 自注册。替换成:

```js
  // ---------- 设备自注册:admin 建 device token(cn-nodes)-> 设备用它 + 自生成 clientId 连 WS ----------
  const CLIENT_ID = 'smoke-dev-001';
  const regTok = await http('POST', '/device-tokens', { name: 'reg-token', projects: ['cn-nodes'] }, admin);
  assert(regTok.status < 300 && typeof regTok.json.token === 'string' && regTok.json.token.startsWith('dk_'), 'admin 建注册用 device token(dk_)');

  const wsUrl = `${B.replace(/^http/, 'ws')}/api/client/ws?token=${encodeURIComponent(regTok.json.token)}&clientId=${CLIENT_ID}`;
  const ws = new WebSocket(wsUrl);
  const got = { welcome: false, heartbeatAck: false };

  const welcomeMsg = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('welcome timeout')), 5000);
    ws.on('error', reject);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'welcome') { got.welcome = true; clearTimeout(to); resolve(m); }
    });
  });
  assert(got.welcome, 'received welcome');
  assert(Array.isArray(welcomeMsg.projects) && welcomeMsg.projects.length >= 1, 'welcome 带继承自 device token 的 projects');
```

> 说明:原来 `ws` 上响应 job/heartbeatAck 的第二个 `ws.on('message', ...)` 块、`heartbeat` 发送、后续 invoke 段**都不动**——它们靠 `ws`/`got`/`CLIENT_ID` 变量,上面已提供。原本 result 回帧里写死 `clientId: 'dev-001'`,把它改成 `clientId: CLIENT_ID`(见 Step 2)。

- [ ] **Step 2: result 回帧的 clientId 用自生成值**

原 job 响应块里 `clientId: 'dev-001'` 改为 `clientId: CLIENT_ID`(设备回结果自报的 clientId,鉴权身份以 socket 上的 `CLIENT_ID` 为准)。

- [ ] **Step 3:(在 2b device-token CRUD 断言块后、`ws.close()` 前)加「注册 token 在线设备数=1」断言**

```js
  // 设备已在线,注册用 token 的在线设备数应为 1
  const regList = await http('GET', '/device-tokens', null, admin);
  const regRow = (regList.json || []).find((x) => x.id === regTok.json.id);
  assert(!!regRow && regRow.onlineDeviceCount === 1, '注册 token onlineDeviceCount=1(设备已自注册在线)');
```

- [ ] **Step 4: 清掉对 client-login 的残留断言**

删掉原「client login returns wsUrl」「client login projects include ...」两条 assert(已随上线段替换消失即可)。确认 smoke 里不再出现 `/clients`、`/api/client/login`、`cl.json`。

- [ ] **Step 5: 起 API(重建 dist)+ 跑 smoke**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
node_modules/.bin/nest build 2>&1 | tail -3
pkill -f 'node dist/main.js' 2>/dev/null; sleep 1
node dist/main.js > /tmp/api-2c.log 2>&1 &
for i in $(seq 1 20); do curl -s -o /dev/null -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123456"}' && break; sleep 1; done
node test/smoke.e2e.js 2>&1 | tail -50
pkill -f 'node dist/main.js' 2>/dev/null
```
Expected: 全 PASS + `=== SMOKE PASSED ===`,含 welcome/projects、invoke 闭环、注册 token onlineDeviceCount=1。若某条 FAIL,报实际输出别提交。

- [ ] **Step 6: prettier + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/prettier --write "test/**/*.js" >/dev/null
cd /Users/lpitiless/Documents/RER0RPC && git add backend/test/smoke.e2e.js && git commit -m "test(2c): rewrite smoke to device-token self-registration"
```

---

## Task 5: 进度台账 + PR

**Files:** Modify `docs/后端进度.md`

- [ ] **Step 1: 台账 2c → ✅ + 完成记录**

- 总览表 2c 行 ⬜→✅;epic #2 段 2c 前加 ✅;#11(并入 2d)不动。
- 完成记录顶部加:
```markdown
### 2026-07-09 · #2/2c 设备自注册 + 删 client-login — PR #<n>
- WS 网关改 device-token 鉴权(`?token=<dk_>&clientId=<自生成>`)→ cache-aside 校验(fail-open,mirror AccessTokenGuard)→ 取 token 的 projectIds → upsert `devices`(client_id/device_token_id/online/last_seen)+ presence.online + welcome;下线置 online=false + presence.offline。
- 删旧 client-login:`clients`/`client_groups` 两表(破坏式 drop 迁移 0002)+ `src/application/client/`(7 文件)+ `POST /clients`/`GET /clients`/`POST /api/client/login` + ClientService/Controller/Module + `ProjectsService.projectsOfClient` + seed 的 demo 设备 + `read/create client` 权限。
- 补 2b 延后项:device-token WS 校验缓存 + revoke/delete 缓存失效 + `devices.device_token_id` 索引。
- 权限降到 13 条;seed 不再预置设备(改自注册)。
- 验证:build/lint/format 绿;full e2e smoke 重写为 device-token 自注册闭环全绿。
- 计划:`docs/superpowers/plans/2026-07-09-2c-device-self-register.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add docs/后端进度.md && git commit -m "docs(2c): mark device self-register done + completion record" && git push -u origin feat/2c-device-self-register && gh pr create --base main --title "feat(2c): 设备自注册 + 删 client-login" --body "epic #2 子项 2c(最大一块)。WS 改 device-token 自注册 + 删整个 client-login(drop clients/client_groups)。计划见 docs/superpowers/plans/2026-07-09-2c-device-self-register.md"
```

- [ ] **Step 3:** 回填 PR 号到完成记录,补一提交。

---

## Self-Review

- **Spec 覆盖**(设计 §5/§6/§7/§8 子项3):device-token WS 自注册✓ 继承 projectIds✓ upsert devices✓ presence✓ welcome✓ 下线清理✓;删 clients/client_groups/client-login 全套✓;device-token 校验 cache-aside + 撤销/删失效✓;`devices.device_token_id` 索引(2b 延后)✓。platform/last_ip/extra **明确留 2d**(§8)。
- **类型一致**:`validateForConnect → {tokenId, projectIds}` 在网关消费一致;`DevicesService.{registerOnline(clientId,deviceTokenId),markOffline(clientId)}` 网关调用一致;`presence.online(clientId, projectIds:number[])` 与 device token 的 projectIds 类型一致;`ConnectionRegistry` 接口不变。
- **删除完备性**(依 Haiku 审计的 8 处引用):app.module、projects.service(projectsOfClient+import)、seed-admin(import+权限+demo块)、smoke——全覆盖;Task 3 Step 6 grep 兜底。
- **占位扫描**:无 TODO/TBD;每步完整代码或精确命令。
- **无环**:WsModule import DeviceTokenModule+DevicesModule(infra→app,已核实无反向依赖)。
- **缓存准则**:校验 cache-aside fail-open;revoke/delete 主动删缓存;WS 生命周期主动写 presence——全符合 [[redis-cache-invalidation]]。
