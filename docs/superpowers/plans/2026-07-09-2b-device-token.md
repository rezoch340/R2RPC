# 2b: device token(设备注册凭证 + CRUD + 在线设备数)实现计划

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `device_tokens` + `device_token_projects` 两表 + 一个镜像 access-token 模块的 CRUD(建/列/撤销/软删),权限 `manage/device-token`,列表带「该 token 上了多少在线设备」。

**Architecture:** 几乎 1:1 镜像现有 `access-token` 模块(`AccessTokenService/Controller/Module/DTO` + `access_tokens`/`access_token_projects` 两表),把 `rk_` 换成 `dk_`、`access` 换成 `device`。device token 建时勾 project(`device_token_projects`),设备的 project 归属未来继承它(2c)。为让「在线设备数」现在就可查,**本子项给 `devices` 加一个可空 `device_token_id` FK**(2c 自注册时才写值,现返回 0)。**2b 无鉴权热路径**(device token 的校验缓存是 2c 的 WS 网关的事),故 service 不碰 Redis。

**Tech Stack:** NestJS 11 + drizzle-orm 0.45(`drizzle-orm/node-postgres`)+ drizzle-kit 0.31 + class-validator + CASL RBAC。

## Global Constraints

- **不直接提交 main。** 已在分支 `feat/2b-device-token`。功能分支 → PR → 合并。
- **提交/PR 前必须**(从 `backend/` 跑):`pnpm build`、`pnpm lint`、`pnpm format`(或直接 `node_modules/.bin/{nest build,eslint ...,prettier ...}`——本机 pnpm 脚本包装器有个 verify-deps 自动 install 的坑,cwd 不在 `backend/` 时会失败;**务必先 `cd backend`**)。
- **实体表铁律**([[entity-tables-need-description]] / [[soft-delete-non-log-entities]]):`device_tokens` 是实体表 → 必须有 `description` + 软删(`deleted_at` + `alive()`/`softDelete()`,来自 `backend/src/common/db/soft-delete.ts`)+ token 的 partial unique `where deleted_at is null`。`device_token_projects` 是纯关联表(无独立生命周期),镜像 `access_token_projects`:不加 `deleted_at`,只 `description`。
- **有 API 走 API 验证**([[api-vs-pg-boundary]]):device-token 有 CRUD API → 冒烟走 HTTP,不直连 PG。
- **冷热/缓存准则**([[redis-cache-invalidation]]):2b CRUD **不引入 Redis**(无消费方);2c 给 device-token 加 WS 校验缓存时,`revoke`/`delete` 必须同步删缓存——**本计划在 revoke/delete 处留 `// ponytail:` 注释标注该升级点**。
- **权限自由串**(已核实):CASL ability 直接吃 DB `permissions` 行,新 subject `'device-token'` **无需任何注册**,只需 seed 一行 + 控制器上 `@RequirePermission('manage','device-token')`;admin `isRoot` 直通(`permission.guard.ts:48`)。

---

## File Structure

- **新目录 `backend/src/application/device-token/`**(单数,对齐 `access-token/`):
  - `device-token.schema.ts` — `deviceTokens` + `deviceTokenProjects` 两表
  - `device-token.service.ts` — `DeviceTokenService`(create/list/revoke/delete + 在线设备数)
  - `device-token.controller.ts` — `DeviceTokenController`(4 端点,`manage/device-token`)
  - `device-token.module.ts` — `DeviceTokenModule`(imports ProjectsModule,exports service)
  - `dto/create-device-token.dto.ts` — `CreateDeviceTokenDto`
- **改** `backend/src/application/devices/devices.schema.ts` — 加可空 `device_token_id` FK
- **改** `backend/src/app.module.ts` — 注册 `DeviceTokenModule`
- **改** `backend/src/scripts/seed-admin.ts` — `ALL_PERMISSIONS` 加 `manage/device-token`
- **改** `backend/test/smoke.e2e.js` — device-token CRUD 断言
- **新迁移** `backend/drizzle/0001_*.sql`(drizzle-kit 生成,增量)

---

## Task 1: schema 两表 + `devices.device_token_id` + 增量迁移

**Files:**
- Create: `backend/src/application/device-token/device-token.schema.ts`
- Modify: `backend/src/application/devices/devices.schema.ts`
- Generate: `backend/drizzle/0001_*.sql` + meta

**Interfaces:**
- Produces:`deviceTokens`(id, name, token, status, expiresAt, description, createdBy, createdAt, deletedAt);`deviceTokenProjects`(tokenId, projectId, description, PK);`devices.deviceTokenId`(可空 int FK→deviceTokens.id)。

- [ ] **Step 1: 建 `device-token.schema.ts`**(镜像 `access-token.schema.ts`,`access`→`device`)

```ts
import {
  integer,
  pgTable,
  primaryKey,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '../users/users.schema';
import { projects } from '../projects/projects.schema';

// Device Token 表——设备自注册上线凭证(明文进 SDK 配置)。镜像 access_tokens 结构。
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    token: varchar('token', { length: 128 }).notNull(), // 明文可回看
    status: varchar('status', { length: 16 }).notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    description: varchar('description', { length: 255 }),
    createdBy: integer('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('device_tokens_token_uq')
      .on(t.token)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

// Device Token 与 project 的关联——多对多。设备上线继承该 token 勾定的 project(2c)。
export const deviceTokenProjects = pgTable(
  'device_token_projects',
  {
    tokenId: integer('token_id')
      .notNull()
      .references(() => deviceTokens.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.projectId] })],
);
```

- [ ] **Step 2: 给 `devices.schema.ts` 加可空 `device_token_id`**

在 import 区加 `import { integer } from 'drizzle-orm/pg-core';`(把 `integer` 加进现有那一组 import),并在 import `deviceTokens`:

```ts
import {
  boolean,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { deviceTokens } from '../device-token/device-token.schema';
```

在表定义里 `clientId` 之后加一列(可空,记录设备由哪个 device token 上来;2c 自注册时写值,现为 NULL):

```ts
    clientId: varchar('client_id', { length: 128 }).notNull(),
    deviceTokenId: integer('device_token_id').references(() => deviceTokens.id),
    online: boolean('online').notNull().default(false),
```

> ⚠️ **决策(可评审否决):** 本子项就给 `devices` 加 `device_token_id`(而非留到 2c),好让 device-token 列表的「在线设备数」现在就有真实字段可数(2c 前恒为 0)。若你想把这列推到 2c,删掉 Step 2 + Task 2 的在线数改为恒 0/省略。

- [ ] **Step 3: 生成增量迁移**(纯新增表 + 新增列,非交互)

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/drizzle-kit generate
```
Expected: 生成 `drizzle/0001_*.sql`,含 `CREATE TABLE "device_tokens"`、`CREATE TABLE "device_token_projects"`、`ALTER TABLE "devices" ADD COLUMN "device_token_id"`。**无交互 prompt**。抽查:

```bash
grep -nE 'CREATE TABLE "(device_tokens|device_token_projects)"|ADD COLUMN "device_token_id"' drizzle/0001_*.sql
```
Expected: 三处命中。

- [ ] **Step 4: 应用迁移 + reseed(幂等)**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/migrate.ts && node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts
```
Expected: `迁移完成`;seed 无报错(此刻 seed 还没加新权限,Task 2 再补)。

- [ ] **Step 5: 验证 schema 同步 + build**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/drizzle-kit generate && node_modules/.bin/nest build 2>&1 | tail -5
```
Expected: `No schema changes, nothing to migrate`;build 退出 0(新 schema 文件被 `deviceTokenId` FK 引用,能编译)。

- [ ] **Step 6: 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add backend/src/application/device-token/device-token.schema.ts backend/src/application/devices/devices.schema.ts backend/drizzle && git commit -m "feat(2b): device_tokens + device_token_projects schema + devices.device_token_id + migration"
```

---

## Task 2: DeviceTokenService/Controller/Module/DTO + 注册 + 权限 seed

**Files:**
- Create: `device-token/dto/create-device-token.dto.ts`, `device-token/device-token.service.ts`, `device-token/device-token.controller.ts`, `device-token/device-token.module.ts`
- Modify: `src/app.module.ts`, `src/scripts/seed-admin.ts`

**Interfaces:**
- Consumes:Task 1 的 `deviceTokens`/`deviceTokenProjects`/`devices.deviceTokenId`;`ProjectsService.idByName`;`alive`/`softDelete`。
- Produces:`DeviceTokenService`(create/list/revoke/delete);`POST/GET/POST :id/revoke/DELETE :id` on `/device-tokens`;permission `manage/device-token`。

- [ ] **Step 1: 建 `dto/create-device-token.dto.ts`**(镜像 create-access-token.dto)

```ts
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateDeviceTokenDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  projects: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;
}
```

- [ ] **Step 2: 建 `device-token.service.ts`**(镜像 access-token.service,去 Redis,加在线设备数)

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { devices } from '../devices/devices.schema';
import { projects } from '../projects/projects.schema';
import { ProjectsService } from '../projects/projects.service';
import { deviceTokenProjects, deviceTokens } from './device-token.schema';

@Injectable()
export class DeviceTokenService {
  constructor(
    private readonly dbService: DbService,
    private readonly projects: ProjectsService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 创建 DeviceToken:去重 project 名 -> 验证存在 -> 事务插 deviceTokens + deviceTokenProjects
   * -> 返回 token 行 + 明文 + project 名。token 前缀 dk_(区别于 access token 的 rk_)。
   */
  async create(input: {
    name: string;
    projects: string[];
    expiresAt?: Date;
    description?: string;
    createdBy?: number;
  }) {
    const projectNames = [...new Set(input.projects)];

    const projectIds: number[] = [];
    for (const projectName of projectNames) {
      const gid = await this.projects.idByName(projectName);
      if (gid === null) {
        throw new BadRequestException(`功能组不存在: ${projectName}`);
      }
      projectIds.push(gid);
    }

    const token = 'dk_' + randomBytes(24).toString('base64url');

    const result = await this.db.transaction(async (tx) => {
      const [tokenRow] = await tx
        .insert(deviceTokens)
        .values({
          name: input.name,
          token,
          expiresAt: input.expiresAt,
          description: input.description,
          createdBy: input.createdBy,
        })
        .returning();

      for (const projectId of projectIds) {
        await tx
          .insert(deviceTokenProjects)
          .values({ tokenId: tokenRow.id, projectId });
      }

      return tokenRow;
    });

    return { ...result, token, projects: projectNames };
  }

  /**
   * 列表:所有 token + project 名 + 在线设备数(count devices where device_token_id=? and online, alive)。
   */
  async list() {
    const tokens = await this.db
      .select()
      .from(deviceTokens)
      .where(alive(deviceTokens));

    return Promise.all(
      tokens.map(async (t) => {
        const projectNames = await this.db
          .select({ name: projects.name })
          .from(deviceTokenProjects)
          .innerJoin(
            projects,
            alive(projects, eq(deviceTokenProjects.projectId, projects.id)),
          )
          .where(eq(deviceTokenProjects.tokenId, t.id));

        const [{ n }] = await this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(devices)
          .where(
            alive(
              devices,
              and(eq(devices.deviceTokenId, t.id), eq(devices.online, true)),
            ),
          );

        return {
          ...t,
          projects: projectNames.map((g) => g.name),
          onlineDeviceCount: n,
        };
      }),
    );
  }

  /** 撤销:status='revoked'。 */
  async revoke(id: number) {
    const [row] = await this.db
      .update(deviceTokens)
      .set({ status: 'revoked' })
      .where(eq(deviceTokens.id, id))
      .returning();
    if (!row) throw new NotFoundException('Device token 不存在');
    // ponytail: 2c 给 device-token 加 WS 校验缓存后,这里必须同步删该 token 的 redis 缓存(照 AccessTokenService.revoke)
    return row;
  }

  /** 软删(与 revoke 正交)。 */
  async delete(id: number) {
    const rows = await softDelete(this.db, deviceTokens, eq(deviceTokens.id, id));
    if (rows.length === 0) throw new NotFoundException('Device token 不存在');
    // ponytail: 2c 加缓存后,这里同步删 redis 缓存(照 AccessTokenService.delete)
    return { deleted: true };
  }
}
```

- [ ] **Step 3: 建 `device-token.controller.ts`**(镜像 access-token.controller)

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthedRequest } from '../../common/types/authed-request';
import { DeviceTokenService } from './device-token.service';
import { CreateDeviceTokenDto } from './dto/create-device-token.dto';

@ApiTags('device-token')
@ApiBearerAuth()
@Controller('device-tokens')
export class DeviceTokenController {
  constructor(private readonly tokens: DeviceTokenService) {}

  @Post()
  @RequirePermission('manage', 'device-token')
  @ApiOperation({ summary: '生成 device token(返回明文,供 SDK 配置)' })
  create(@Body() dto: CreateDeviceTokenDto, @Req() req: AuthedRequest) {
    return this.tokens.create({
      name: dto.name,
      projects: dto.projects,
      description: dto.description,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      createdBy: req.user?.id,
    });
  }

  @Get()
  @RequirePermission('manage', 'device-token')
  @ApiOperation({ summary: '列表:所有 device token(含明文、project 名、在线设备数)' })
  list() {
    return this.tokens.list();
  }

  @Post(':id/revoke')
  @RequirePermission('manage', 'device-token')
  @ApiOperation({ summary: '撤销 device token' })
  revoke(@Param('id', ParseIntPipe) id: number) {
    return this.tokens.revoke(id);
  }

  @Delete(':id')
  @RequirePermission('manage', 'device-token')
  @ApiOperation({ summary: '删除 device token(软删,与撤销正交)' })
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.tokens.delete(id);
  }
}
```

- [ ] **Step 4: 建 `device-token.module.ts`**(非 @Global;imports ProjectsModule;exports service 供 2c)

```ts
import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { DeviceTokenController } from './device-token.controller';
import { DeviceTokenService } from './device-token.service';

@Module({
  imports: [ProjectsModule],
  controllers: [DeviceTokenController],
  providers: [DeviceTokenService],
  exports: [DeviceTokenService],
})
export class DeviceTokenModule {}
```

- [ ] **Step 5: 注册进 `app.module.ts`**

import(与其它 application 模块放一起):

```ts
import { DeviceTokenModule } from './application/device-token/device-token.module';
```

imports 数组里,`AccessTokenModule,` 之后加一行:

```ts
    AccessTokenModule,
    DeviceTokenModule,
    DevicesModule,
```

- [ ] **Step 6: seed 权限 `manage/device-token`**

`seed-admin.ts` 的 `ALL_PERMISSIONS` 数组,在 `{ action: 'manage', subject: 'access-token' },` 之后加一行:

```ts
  { action: 'manage', subject: 'access-token' },
  { action: 'manage', subject: 'device-token' },
];
```

- [ ] **Step 7: build + lint + format + reseed(补权限)**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -5 && node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts" --fix && node_modules/.bin/prettier --write "src/**/*.ts" >/dev/null && node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts 2>&1 | tail -3
```
Expected: build 0;lint 无错;seed 打印「权限 15 条」(原 14 + device-token)。

- [ ] **Step 8: 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add -A backend/src backend/package.json 2>/dev/null; git add backend/src && git commit -m "feat(2b): device-token CRUD module + manage/device-token permission"
```

---

## Task 3: 冒烟(走 API)

**Files:** Modify `backend/test/smoke.e2e.js`

**Interfaces:** Consumes 已迁移+seed 的库 + 运行中的 API。

- [ ] **Step 1: 在 smoke.e2e.js 加 device-token CRUD 块**

在软删除 Phase 4 块之后、`ws.close();` 之前,插入(admin 是 isRoot,直通权限):

```js
  // ---------- 2b:device token CRUD(admin isRoot 直通 manage/device-token)----------
  const dtCreate = await http('POST', '/device-tokens', { name: 'dt-smoke', projects: ['cn-nodes'] }, admin);
  assert(dtCreate.status < 300 && typeof dtCreate.json.token === 'string' && dtCreate.json.token.startsWith('dk_'), 'create device token -> 明文 dk_ token');
  assert(Array.isArray(dtCreate.json.projects) && dtCreate.json.projects.includes('cn-nodes'), 'device token 回显 project cn-nodes');
  const dtList = await http('GET', '/device-tokens', null, admin);
  const dtRow = (dtList.json || []).find((x) => x.id === dtCreate.json.id);
  assert(!!dtRow && dtRow.onlineDeviceCount === 0, 'device token 列表含它且 onlineDeviceCount=0(2c 前无设备继承)');
  const dtRevoke = await http('POST', `/device-tokens/${dtCreate.json.id}/revoke`, null, admin);
  assert(dtRevoke.status < 300 && dtRevoke.json.status === 'revoked', 'revoke device token -> status revoked');
  const dtDel = await http('DELETE', `/device-tokens/${dtCreate.json.id}`, null, admin);
  assert(dtDel.status < 300, 'soft-delete device token');
  const dtList2 = await http('GET', '/device-tokens', null, admin);
  assert(!(dtList2.json || []).some((x) => x.id === dtCreate.json.id), '软删后 device token 不再出现在列表(alive 过滤)');
```

- [ ] **Step 2: 起 API + 跑冒烟**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend
node dist/main.js > /tmp/api-2b.log 2>&1 &
API_PID=$!
for i in $(seq 1 20); do curl -s -o /dev/null -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123456"}' && break; sleep 1; done
node test/smoke.e2e.js 2>&1 | tail -50
kill $API_PID 2>/dev/null
```
Expected: 全部 PASS,含新增 6 条 device-token 断言 + `=== SMOKE PASSED ===`。
> 注:跑前确保 dist 是最新(Task 2 后 `node_modules/.bin/nest build`)。

- [ ] **Step 3: 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add backend/test/smoke.e2e.js && git commit -m "test(2b): device-token CRUD smoke assertions"
```

---

## Task 4: 进度台账 + PR

**Files:** Modify `docs/后端进度.md`

- [ ] **Step 1: 台账 2b → ✅ + 完成记录**

- 总览表 `| 2b | └ device token... | 高 | ⬜ | — |` 状态 ⬜→✅。
- epic #2 段 `- **2b** device token...` 前加 ✅。
- 「完成记录(倒序)」顶部加:

```markdown
### 2026-07-09 · #2/2b device token — PR #<n>
- 新表 `device_tokens`(镜像 access_tokens,token 前缀 `dk_`,实体表带 description+软删+partial unique)+ `device_token_projects`(M2M)。
- CRUD `/device-tokens`(建返明文/列表含 project 名+在线设备数/撤销/软删),权限 `manage/device-token`(admin isRoot 直通),镜像 access-token 模块。
- `devices` 加可空 `device_token_id` FK(2c 自注册写值,现在线数恒 0)。
- 增量迁移 `0001`;seed 加 `manage/device-token`(权限 15 条)。
- 2b 无 Redis(无消费方);revoke/delete 留 ponytail 注释,2c 加 WS 校验缓存时补缓存失效。
- 验证:build/lint/format 绿;冒烟走 API(device-token CRUD 6 断言)全绿。
- 计划:`docs/superpowers/plans/2026-07-09-2b-device-token.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add docs/后端进度.md && git commit -m "docs(2b): mark device token done + completion record" && git push -u origin feat/2b-device-token && gh pr create --base main --title "feat(2b): device token(注册凭证 + CRUD + 在线设备数)" --body "epic #2 子项 2b。镜像 access-token 加 device_tokens/device_token_projects + CRUD + manage/device-token;devices 加 device_token_id(2c 写值)。计划见 docs/superpowers/plans/2026-07-09-2b-device-token.md"
```

- [ ] **Step 3:** 回填 PR 号到完成记录,补一提交。

---

## Self-Review

- **Spec 覆盖**(设计文档 §4/§6/§8 子项2):`device_tokens`✓ `device_token_projects`✓ CRUD✓ `manage/device-token`✓ 在线设备数✓(经 `devices.device_token_id`)。镜像 access-token 模式✓。独立无依赖✓(仅额外给 devices 加一列)。
- **类型一致**:`DeviceTokenService.{create,list,revoke,delete}` 与 controller 调用名一致;`deviceTokenProjects.projectId`/`.tokenId` schema↔service 一致;`devices.deviceTokenId` schema↔service 一致;DTO 字段 `projects` 与 service 入参一致。
- **占位扫描**:无 TODO/TBD;每步给了完整代码或精确命令。两处 `// ponytail:` 是 2c 升级点标注,非占位。
- **铁律**:`device_tokens` 有 description+deleted_at+partial unique(实体表合规);关联表 `device_token_projects` 无 deleted_at(镜像 access_token_projects,对)。
