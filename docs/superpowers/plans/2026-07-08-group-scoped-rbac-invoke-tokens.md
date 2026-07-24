# 三套授权域 Implementation Plan

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 给 R2RPC 落地三套授权域:后台 CASL RBAC、设备组一等实体(设备多组)、invoke 独立 access token(按设备组作用域、可过期)。

**Architecture:** 后台走用户 JWT + `PermissionGuard`(CASL)+ isRoot;设备组升为一等实体(FK)+ `client_groups` 多对多;invoke/clientQueue 改用 `AccessTokenGuard`(独立 token,redis 缓存)。三套互不耦合。

**Tech Stack:** NestJS 11 · Drizzle ORM · PostgreSQL · Redis(ioredis)· BullMQ · `@casl/ability`(新)· pnpm · Jest。

## Global Constraints

- 包管理 pnpm;ORM Drizzle,表定义在 `{module}.schema.ts`,迁移用 `pnpm db:generate` + 编程式 `pnpm db:migrate`。
- 遵守 `docs/design-conventions.md`:controller 薄、service 厚、无 `repository.ts`、热路径不做慢 IO(access token 查询走 redis 缓存)。
- 全局 `ValidationPipe({whitelist:true})`:DTO 每个字段必须有 class-validator 装饰器,否则被剥。
- 注释中文;每阶段 `nest build` 通过 + 端到端验证 + 更新 `CHANGELOG.md` + 提交(emoji + 中文)。
- 数据库改动经 `pnpm db:migrate`,不在 app 启动自动迁移。
- 验证基础设施:`docker compose -f deploy/docker-compose.yml`(PG/Redis/Manticore 已在跑)。

---

## 文件结构(按阶段)

**阶段1 设备组一等实体**
- 改 `src/application/client/client.schema.ts`(去 group_name)
- 新 `src/application/client/client-groups.schema.ts`(client_groups M2M)
- 改 `src/application/devices/devices.schema.ts`(去 group_name)
- 新 `src/scripts/migrate-groups.ts`(回填)
- 改 `src/application/client/client.service.ts`(登录去 group + 多组)
- 改 `src/application/client/dto/client-login.dto.ts`(去 group)
- 改 `src/application/groups/groups.service.ts`(findByName / findByNames→ids)
- 改 `src/infrastructure/ws/presence.service.ts`(按 group_id 多组)
- 改 `src/infrastructure/ws/ws.gateway.ts`(多组 presence)
- 改 `src/application/rpc/rpc.service.ts` + `rpc.controller.ts`(:group 名字→id)
- 改 `src/scripts/seed-admin.ts`(建组 + 关联)

**阶段2 后台 CASL RBAC**
- 新 `src/application/rbac/rbac.schema.ts`(roles/permissions/role_permissions/user_roles)
- 改 `src/application/users/users.schema.ts`(+ is_root)
- 新 `src/application/rbac/rbac.service.ts` · `rbac.controller.ts` · `rbac.module.ts` · `dto/`
- 新 `src/common/decorators/require-permission.decorator.ts`
- 新 `src/common/guards/permission.guard.ts`
- 改 `src/application/auth/jwt.strategy.ts`(加载 permissions/isRoot)
- 改 `src/app.module.ts`(APP_GUARD 换 PermissionGuard)
- 改所有后台 controller(补 `@RequirePermission`)
- 改 `src/application/auth/auth.controller.ts`(/me 返回 permissions)
- 改 `src/scripts/seed-admin.ts`(isRoot + operator 角色 + 权限)

**阶段3 invoke Access Token**
- 新 `src/application/access-token/access-token.schema.ts`(access_tokens + access_token_groups)
- 新 `src/application/access-token/access-token.service.ts` · `access-token.controller.ts` · `access-token.module.ts` · `dto/`
- 新 `src/common/guards/access-token.guard.ts`
- 改 `src/application/rpc/rpc.controller.ts`(@Public + @UseGuards(AccessTokenGuard))+ `rpc.module.ts`
- 改 `src/application/request-logs/request-logs.schema.ts` + `request-logs.service.ts`(access_token_id)
- 改 `src/application/rpc/rpc.service.ts`(requester = access token)
- 改 `backend/test/smoke.e2e.js`(invoke 用 access token)

---

# 阶段 1:设备组一等实体 + 多组

### Task 1.1:设备组 schema — 去 group_name、加 client_groups、加 FK

**Files:**
- Modify: `src/application/client/client.schema.ts`
- Create: `src/application/client/client-groups.schema.ts`
- Modify: `src/application/devices/devices.schema.ts`

**Interfaces produced:** `clients`(无 groupName)、`clientGroups`(clientId, groupId)、`devices`(无 groupName)。

- [ ] **Step 1: 改 client.schema.ts** — 删 `groupName` 列:
```ts
import { pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

// 手机设备账号(组成员关系走 client_groups)
export const clients = pgTable('clients', {
  id: serial('id').primaryKey(),
  clientId: varchar('client_id', { length: 128 }).notNull().unique(),
  secretHash: varchar('secret_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: 建 client-groups.schema.ts**:
```ts
import { integer, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { clients } from './client.schema';
import { groups } from '../groups/groups.schema';

// 设备 ↔ 设备组 多对多(设备多组)
export const clientGroups = pgTable(
  'client_groups',
  {
    clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.groupId] })],
);
```

- [ ] **Step 3: 改 devices.schema.ts** — 删 `groupName` 列(保留 clientId/online/lastSeenAt)。

- [ ] **Step 4: 生成迁移**（先不 migrate,回填在 1.2）:
Run: `cd backend && pnpm db:generate`
Expected: 生成新迁移 SQL(建 client_groups + 加 FK + drop group_name 列)

- [ ] **Step 5: Commit** `git add -A && git commit -m "🧱 设备组 schema:client_groups 多对多 + FK,去 group_name"`

> ⚠️ 注意:groups.schema.ts 的 `id` 是 `serial`(integer),FK 用 `integer(...).references(()=>groups.id)`。clients.id 同理。

---

### Task 1.2:回填脚本 + 应用迁移

**Files:**
- Create: `src/scripts/migrate-groups.ts`

**Interfaces consumed:** `clients`、`groups`、`clientGroups`。

- [ ] **Step 1: 写回填脚本**（在删列的迁移**之前**跑,所以脚本读旧 group_name 需在 drop 前执行——策略:先手动跑回填 SQL 再 migrate。用脚本直连旧列):
```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { ConfigService } from '../infrastructure/config/config.service';

// 一次性回填:旧 clients.group_name 字符串 → groups 行 + client_groups 关联。
// 必须在 "drop group_name" 迁移之前运行(此时列还在)。
async function main() {
  const cfg = new ConfigService();
  const pool = new Pool(cfg.db);
  const db = drizzle(pool);
  // 建缺失的 group 行
  await db.execute(sql`
    insert into groups (name)
    select distinct group_name from clients
    where group_name is not null
    on conflict (name) do nothing`);
  // 建关联
  await db.execute(sql`
    insert into client_groups (client_id, group_id)
    select c.id, g.id from clients c join groups g on g.name = c.group_name
    on conflict do nothing`);
  console.log('分组回填完成');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```
> 因回填要在 drop 列前跑,而 1.1 的迁移会 drop 列:执行顺序 = 先手动应用「建 client_groups + FK」部分,回填,再应用「drop group_name」。**简化(本项目是测试数据):允许 `docker compose ... down -v` 清库 → migrate → seed(1.6 的种子直接建组+关联),跳过回填。** 采用哪条在 1.6 决定;脚本留作生产参考。

- [ ] **Step 2: 加 package.json 脚本** `"migrate:groups": "ts-node -r tsconfig-paths/register src/scripts/migrate-groups.ts"`

- [ ] **Step 3: Commit** `git commit -am "🔀 分组回填脚本"`

---

### Task 1.3:设备登录去 group + 多组 token

**Files:**
- Modify: `src/application/client/dto/client-login.dto.ts`(删 group 字段)
- Modify: `src/application/client/client.service.ts`
- Modify: `src/application/groups/groups.service.ts`(加 findIdsByClient / resolveName)

**Interfaces produced:**
- `GroupsService.idByName(name: string): Promise<number | null>`
- `GroupsService.namesByClient(clientDbId: number): Promise<{id:number,name:string}[]>`
- `ClientService.login(clientId, secret)`(去 group)→ `{ token, wsUrl, clientId, groups: string[] }`
- device JWT payload:`{ sub: clientId, clientId, groups: number[], groupNames: string[], role:'client' }`

- [ ] **Step 1: client-login.dto.ts** 删 `group`,只留 `clientId`、`secret`(都带 @IsString)。

- [ ] **Step 2: GroupsService 加方法**(用 `clientGroups` join):
```ts
async idByName(name: string) {
  const [g] = await this.db.select({ id: groups.id }).from(groups).where(eq(groups.name, name)).limit(1);
  return g?.id ?? null;
}
async groupsOfClient(clientDbId: number) {
  return this.db.select({ id: groups.id, name: groups.name })
    .from(clientGroups).innerJoin(groups, eq(clientGroups.groupId, groups.id))
    .where(eq(clientGroups.clientId, clientDbId));
}
```
(import clientGroups from '../client/client-groups.schema')

- [ ] **Step 3: ClientService.login 改**:按 clientId 查 client 行 → verify secret → 查其组(groupsOfClient)→ 签发 JWT(带 groups id + names)→ wsUrl。createAccount 改为接收 `{clientId, secret, groups: string[]}`,建 client + 建 client_groups(组名解析成 id,不存在的组报错或建)。
```ts
async login(clientId: string, secret: string) {
  const acc = await this.findByClientId(clientId);
  if (!acc || !verifyPassword(secret, acc.secretHash)) throw new UnauthorizedException('设备登录凭据无效');
  const grps = await this.groups.groupsOfClient(acc.id);
  const token = await this.jwt.signAsync({
    sub: clientId, clientId, role: 'client',
    groups: grps.map(g => g.id), groupNames: grps.map(g => g.name),
  });
  const base = this.cfg.app.publicWsUrl ?? `ws://127.0.0.1:${this.cfg.app.port}`;
  return { token, wsUrl: `${base}/api/client/ws?token=${token}`, clientId, groups: grps.map(g => g.name) };
}
```
createAccount(input: {clientId; secret; groups: string[]}):建 client 行,再对每个 group name → idByName(不存在则 GroupsService.create)→ 插 client_groups。

- [ ] **Step 4: create-client.dto.ts** 改:`clientId`、`secret`、`groups: string[]`(`@IsArray() @IsString({each:true})`)。ClientController.create 传 dto。

- [ ] **Step 5: 验证 build** `pnpm build`(阶段末统一跑端到端)

- [ ] **Step 6: Commit** `git commit -am "📱 设备登录去 group、支持多组;设备账号建组关联"`

---

### Task 1.4:WS presence 多组

**Files:**
- Modify: `src/infrastructure/ws/presence.service.ts`
- Modify: `src/infrastructure/ws/ws.gateway.ts`

**Interfaces produced:**
- `PresenceService.online(clientId, groupIds:number[])` / `offline(clientId, groupIds:number[])` / `refresh(clientId)`
- `PresenceService.pickOnline(groupId:number)` / `listOnline(groupId:number)`(key 改 group_id)

- [ ] **Step 1: presence.service.ts** — key 改 `group:clients:{groupId}`,online/offline 接收 groupIds 数组循环 sadd/srem;pickOnline/listOnline 参数改 number(groupId)。`presence:{clientId}` 仍是在线标记(值可存 groupIds JSON,便于断线清理)。
```ts
async online(clientId: string, groupIds: number[]) {
  await this.r.set(`presence:${clientId}`, JSON.stringify(groupIds), 'EX', PRESENCE_TTL);
  for (const gid of groupIds) await this.r.sadd(`group:clients:${gid}`, clientId);
}
async offline(clientId: string, groupIds: number[]) {
  await this.r.del(`presence:${clientId}`);
  for (const gid of groupIds) await this.r.srem(`group:clients:${gid}`, clientId);
}
async pickOnline(groupId: number): Promise<string|null> { /* 同现逻辑,key 用 groupId */ }
```

- [ ] **Step 2: ws.gateway.ts** — token 解出 `groups: number[]`;`socket._groups = groups`;`presence.online(clientId, groups)`;断线 `presence.offline(clientId, socket._groups)`。heartbeat 仍 refresh(clientId)。

- [ ] **Step 3: Commit** `git commit -am "🔌 WS presence 改按 group_id 多组登记"`

---

### Task 1.5:invoke 按 group_id 调度

**Files:**
- Modify: `src/application/rpc/rpc.service.ts`
- Modify: `src/application/rpc/rpc.controller.ts`
- Modify: `src/application/rpc/rpc.module.ts`(import GroupsModule)

**Interfaces consumed:** `GroupsService.idByName`、`PresenceService.pickOnline(groupId)`。

- [ ] **Step 1: RpcService.invoke** 开头把 `p.group`(名字)→ `groupId = await groups.idByName(p.group)`;`null` → fail('no_group', 404, '组不存在')。其余 presence 调用改用 groupId。request_logs 仍记 group 名字(p.group)。构造 job 仍带 group 名字(设备侧按名字识别)。
- [ ] **Step 2: RpcController.clientQueue** 的 `?group` 同样 name→id 再 listOnline。
- [ ] **Step 3: rpc.module.ts** import GroupsModule(为 GroupsService);GroupsModule 需 export GroupsService(已 export)。
- [ ] **Step 4: Commit** `git commit -am "📡 invoke/clientQueue 按 group 名字解析 group_id 调度"`

---

### Task 1.6:种子 + 端到端验证(阶段1 收尾)

**Files:**
- Modify: `src/scripts/seed-admin.ts`(建 demo 组 + demo 设备账号 + 关联)
- Modify: `backend/test/smoke.e2e.js`(设备登录去 group;建设备账号带 groups)

- [ ] **Step 1: seed-admin.ts** 追加:建组 `cn-nodes`、`us-nodes`;建设备账号 `dev-001`(secret `secret123`)关联到 `cn-nodes`+`us-nodes`(演示多组)。幂等。
- [ ] **Step 2: smoke.e2e.js** 改:`createAccount` 传 `{clientId, secret, groups:['cn-nodes','us-nodes']}`;`client/login` 传 `{clientId, secret}`;断言 login 返回 `groups` 含两组;invoke 两组各调一次都命中同一设备。
- [ ] **Step 3: 清库重建**(测试数据,走简化路径):
Run: `docker compose -f deploy/docker-compose.yml down -v && sh deploy/dev-up.sh`
Expected: 迁移 + 种子成功
- [ ] **Step 4: build + smoke**:
Run: `cd backend && pnpm build && (node dist/main.js & node dist/worker.js &) && pnpm smoke`
Expected: SMOKE PASSED(含多组断言)
- [ ] **Step 5: 更新 CHANGELOG + Commit** `git commit -am "✅ 阶段1:设备组一等实体+多组,端到端通过"`

---

# 阶段 2:后台 CASL RBAC

### Task 2.1:RBAC schema + users.is_root

**Files:**
- Create: `src/application/rbac/rbac.schema.ts`
- Modify: `src/application/users/users.schema.ts`(+ isRoot)

- [ ] **Step 1: users.schema.ts** 加 `isRoot: boolean('is_root').notNull().default(false)`(import boolean)。
- [ ] **Step 2: rbac.schema.ts**:
```ts
import { integer, pgTable, primaryKey, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import { users } from '../users/users.schema';

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
  description: varchar('description', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  action: varchar('action', { length: 64 }).notNull(),
  subject: varchar('subject', { length: 64 }).notNull(),
}, (t) => [unique('perm_action_subject_uq').on(t.action, t.subject)]);
export const rolePermissions = pgTable('role_permissions', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: integer('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]);
export const userRoles = pgTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);
```
- [ ] **Step 3:** `pnpm db:generate` → migrate(阶段末统一)。
- [ ] **Step 4: Commit** `git commit -am "🧱 RBAC schema + users.is_root"`

---

### Task 2.2:@casl/ability + RbacService

**Files:**
- Modify: `backend/package.json`(add `@casl/ability`)
- Create: `src/application/rbac/rbac.service.ts`
- Create: `src/application/rbac/entity/model.ts`(AuthenticatedUser、PermissionTuple)

**Interfaces produced:**
- `PermissionTuple = { action:string; subject:string }`
- `AuthenticatedUser = { id:number; permissions:PermissionTuple[]; isRoot:boolean }`
- `RbacService.getUserPermissions(userId:number): Promise<PermissionTuple[]>`
- `RbacService.isRoot(userId:number): Promise<boolean>`
- `RbacService.buildAbility(perms): MongoAbility`
- CRUD:`createRole/listRoles/deleteRole/createPermission/listPermissions/attachPermission/detachPermission/assignRole/unassignRole`

- [ ] **Step 1:** `pnpm add @casl/ability`
- [ ] **Step 2: entity/model.ts** 定义 PermissionTuple、AuthenticatedUser。
- [ ] **Step 3: rbac.service.ts**(Drizzle 版，查询使用 drizzle join):
```ts
// getUserPermissions:user_roles → role_permissions → permissions 去重
async getUserPermissions(userId: number): Promise<PermissionTuple[]> {
  const rows = await this.db.selectDistinct({ action: permissions.action, subject: permissions.subject })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(userRoles.userId, userId));
  return rows;
}
async isRoot(userId: number) {
  const [u] = await this.db.select({ isRoot: users.isRoot }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.isRoot ?? false;
}
buildAbility(perms: PermissionTuple[]): MongoAbility {
  const { can, build } = new AbilityBuilder(createMongoAbility);
  for (const p of perms) can(p.action, p.subject);
  return build();
}
```
CRUD 方法用 drizzle insert/delete + onConflictDoNothing;冲突抛 ConflictException。
- [ ] **Step 4: Commit** `git commit -am "🛡️ RbacService(CASL)+ 权限查询/管理"`

---

### Task 2.3:PermissionGuard + @RequirePermission + JwtStrategy 加载 + APP_GUARD 切换

**Files:**
- Create: `src/common/decorators/require-permission.decorator.ts`
- Create: `src/common/guards/permission.guard.ts`
- Modify: `src/application/auth/jwt.strategy.ts`
- Modify: `src/app.module.ts`
- Delete usage: `src/common/guards/roles.guard.ts`(从 APP_GUARD 移除;文件可留)
- Modify: `src/application/rbac/rbac.module.ts`(Global,export RbacService,供 guard/strategy)

**Interfaces produced:**
- `@RequirePermission(action, subject)`(PERMISSION_KEY 元数据)
- `PermissionGuard`(APP_GUARD)

- [ ] **Step 1: require-permission.decorator.ts**:
```ts
import { SetMetadata } from '@nestjs/common';
export const PERMISSION_KEY = 'required-permission';
export interface RequiredPermission { action: string; subject: string; }
export const RequirePermission = (action: string, subject: string) =>
  SetMetadata(PERMISSION_KEY, { action, subject });
```
- [ ] **Step 2: permission.guard.ts**(`@Public` 跳过、无 @RequirePermission fail-closed、isRoot 绕过):
```ts
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private reflector: Reflector, private rbac: RbacService) {}
  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const required = this.reflector.get<RequiredPermission>(PERMISSION_KEY, ctx.getHandler());
    if (!required) throw new ForbiddenException('未声明权限要求');
    const user = ctx.switchToHttp().getRequest().user;
    if (user?.isRoot) return true;
    const ability = this.rbac.buildAbility(user?.permissions ?? []);
    if (!ability.can(required.action, required.subject))
      throw new ForbiddenException(`缺少权限: ${required.action} ${required.subject}`);
    return true;
  }
}
```
(import IS_PUBLIC_KEY from public.decorator)
- [ ] **Step 3: jwt.strategy.ts** validate 改 async,注入 RbacService,加载 permissions+isRoot:
```ts
async validate(payload: JwtPayload) {
  const id = Number(payload.sub);
  const [permissions, isRoot] = await Promise.all([this.rbac.getUserPermissions(id), this.rbac.isRoot(id)]);
  return { id, sub: payload.sub, username: payload.username, permissions, isRoot };
}
```
(AuthModule 需能注入 RbacService → RbacModule Global 或 AuthModule import RbacModule)
- [ ] **Step 4: rbac.module.ts** `@Global()`,providers+exports RbacService。app.module import RbacModule。
- [ ] **Step 5: app.module.ts** providers 的 APP_GUARD 从 `[JwtAuthGuard, RolesGuard]` 改 `[JwtAuthGuard, PermissionGuard]`。
- [ ] **Step 6: Commit** `git commit -am "🛡️ PermissionGuard 替换 RolesGuard;JwtStrategy 加载权限/isRoot"`

---

### Task 2.4:全后台接口补 @RequirePermission

**Files(逐个改 controller):**
- `users.controller.ts`:list/find `@RequirePermission('read','user')`;create `('create','user')`;remove `('delete','user')`(去掉旧 `@Roles('admin')`)
- `groups.controller.ts`:read/create/delete `('read'|'create'|'delete','group')`
- `client.controller.ts`:create/list `('create'|'read','client')`(login 保持 @Public)
- `devices.controller.ts`:若有读接口加 `('read','device')`
- `monitor.controller.ts`:list/detail `('read','monitor')`
- `metrics.controller.ts`:overview `('read','metrics')`

**Interfaces consumed:** `@RequirePermission`。

- [ ] **Step 1:** 逐 controller 把 `@Roles('admin')` 换成方法级 `@RequirePermission(action, subject)`;保留 `@ApiBearerAuth`。删除对 `Roles` 装饰器的 import。
- [ ] **Step 2: Commit** `git commit -am "🔐 后台接口补 @RequirePermission,移除旧 @Roles"`

---

### Task 2.5:RBAC 管理 API + /auth/me

**Files:**
- Create: `src/application/rbac/rbac.controller.ts` · `rbac.module.ts`(已在 2.3 建;此处补 controller)· `dto/`
- Modify: `src/application/auth/auth.controller.ts`(/me 返回 permissions)+ `auth.service.ts`(me 方法)

- [ ] **Step 1: rbac.controller.ts**(`@RequirePermission('manage','rbac')`):
  `POST /rbac/roles`、`GET /rbac/roles`、`DELETE /rbac/roles/:id`、`POST /rbac/permissions`、`GET /rbac/permissions`、`POST /rbac/roles/:roleId/permissions/:permissionId`(attach)、`DELETE ...`(detach)、`POST /rbac/users/:userId/roles/:roleId`(assign)、`DELETE ...`(unassign)。DTO 带校验。
- [ ] **Step 2: auth /me** 返回 `req.user`(已含 permissions/isRoot)——把 `me()` 直接返回 `req.user`,或加 AuthService.me 查 username。
- [ ] **Step 3: Commit** `git commit -am "🛡️ RBAC 管理 API + /auth/me 返回权限"`

---

### Task 2.6:种子 RBAC + 端到端验证(阶段2 收尾)

**Files:**
- Modify: `src/scripts/seed-admin.ts`

- [ ] **Step 1: seed** 追加:admin 置 `is_root=true`;建权限集(read/create/delete × user/group/client + read × monitor/metrics + manage/rbac + manage/access-token);建 `operator` 角色挂 `read/*` 权限。幂等。
- [ ] **Step 2:** 清库重建 + build + 登录测试:admin(isRoot)可访问全部;新建一个非 root 用户挂 operator 角色,只能 read,不能 create(403)。写进 smoke 或临时 curl 验证。
- [ ] **Step 3: 更新 CHANGELOG + Commit** `git commit -am "✅ 阶段2:后台 CASL RBAC,isRoot/权限/403 验证通过"`

---

# 阶段 3:invoke Access Token

### Task 3.1:access token schema

**Files:**
- Create: `src/application/access-token/access-token.schema.ts`
- Modify: `src/application/request-logs/request-logs.schema.ts`(+ access_token_id)

- [ ] **Step 1: access-token.schema.ts**:
```ts
import { integer, pgTable, primaryKey, serial, timestamp, varchar } from 'drizzle-orm/pg-core';
import { users } from '../users/users.schema';
import { groups } from '../groups/groups.schema';

export const accessTokens = pgTable('access_tokens', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  token: varchar('token', { length: 128 }).notNull().unique(),  // 明文可回看
  status: varchar('status', { length: 16 }).notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const accessTokenGroups = pgTable('access_token_groups', {
  tokenId: integer('token_id').notNull().references(() => accessTokens.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.tokenId, t.groupId] })]);
```
- [ ] **Step 2: request-logs.schema.ts** 加 `accessTokenId: integer('access_token_id')`(nullable,不加 FK——脊柱去规范化)。
- [ ] **Step 3:** `pnpm db:generate`。 **Commit** `git commit -am "🧱 access token schema + request_logs.access_token_id"`

---

### Task 3.2:AccessTokenService

**Files:**
- Create: `src/application/access-token/access-token.service.ts`
- Create: `src/application/access-token/dto/create-access-token.dto.ts`

**Interfaces produced:**
- `AccessTokenService.create({name, groups:string[], expiresAt?:Date}): Promise<{...,token,groups}>`
- `AccessTokenService.list()` / `revoke(id)`
- `AccessTokenService.findByToken(token): Promise<{id,name,status,expiresAt,groupIds:number[]}|null>`

- [ ] **Step 1: create-access-token.dto.ts**:`name`(@IsString)、`groups: string[]`(@IsArray @IsString each)、`expiresAt?: string`(@IsOptional @IsDateString)。
- [ ] **Step 2: token 生成**:`import { randomBytes } from 'node:crypto'; const token = 'rk_' + randomBytes(24).toString('base64url');`
- [ ] **Step 3: service**:create → 校验组存在(idByName)→ 插 accessTokens + accessTokenGroups;list → join 组名;revoke → status='revoked';findByToken → 查 token + 其 groupIds(join)。
- [ ] **Step 4: Commit** `git commit -am "🎟️ AccessTokenService:生成/列表/撤销/按 token 查"`

---

### Task 3.3:AccessTokenGuard(redis 缓存)

**Files:**
- Create: `src/common/guards/access-token.guard.ts`
- Create: `src/application/access-token/access-token.module.ts`(Global,export AccessTokenService)

**Interfaces produced:** `AccessTokenGuard`;`req.accessToken = { id, name, groupIds }`。

- [ ] **Step 1: access-token.guard.ts**(按功能组作用域实现):
```ts
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private tokens: AccessTokenService, private groups: GroupsService, private redis: RedisService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const h = req.headers?.authorization;
    const plain = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    if (!plain) throw new UnauthorizedException('缺少 access token');
    // redis 缓存 60s,fail-open
    const key = `invoke:token:${plain}`;
    let t = await this.readCache(key);
    if (t === undefined) { t = await this.tokens.findByToken(plain); await this.writeCache(key, t); }
    if (!t) throw new UnauthorizedException('无效 token');
    if (t.expiresAt && new Date(t.expiresAt) < new Date()) throw new UnauthorizedException('token 已过期');
    if (t.status !== 'active') throw new ForbiddenException('token 已停用/撤销');
    const groupName = req.params?.group ?? req.query?.group;
    const gid = await this.groups.idByName(groupName);
    if (!gid || !t.groupIds.includes(gid)) throw new ForbiddenException('token 无该设备组权限');
    req.accessToken = { id: t.id, name: t.name, groupIds: t.groupIds };
    return true;
  }
}
```
readCache/writeCache:redis get/set JSON,错误 fail-open(返回 undefined 触发回落 DB);负缓存存 `null` 短 TTL。
- [ ] **Step 2: access-token.module.ts** Global,providers AccessTokenService + controller(3.5),exports AccessTokenService。
- [ ] **Step 3: Commit** `git commit -am "🎟️ AccessTokenGuard:验 token + 过期/状态 + 组作用域(redis 缓存)"`

---

### Task 3.4:invoke/clientQueue 接入 + request_logs requester

**Files:**
- Modify: `src/application/rpc/rpc.controller.ts`
- Modify: `src/application/rpc/rpc.module.ts`(import AccessTokenModule)
- Modify: `src/application/rpc/rpc.service.ts`(requester = access token)

- [ ] **Step 1: rpc.controller.ts** invoke/clientQueue 加 `@Public()` + `@UseGuards(AccessTokenGuard)`;`@Req()` 取 `req.accessToken`;invoke 传 `accessTokenId: req.accessToken.id`(替代 requesterUserId)。
- [ ] **Step 2: rpc.service.ts** InvokeParams 加 `accessTokenId?`;enqueueLog 的 RequestLogJob 用 accessTokenId(request-logs.writeSpine 映射到 access_token_id 列)。RequestLogJob 类型 + writeSpine 加 accessTokenId 字段。
- [ ] **Step 3: rpc.module.ts** import AccessTokenModule。
- [ ] **Step 4: Commit** `git commit -am "📡 invoke/clientQueue 改用 AccessTokenGuard;日志记 access_token_id"`

---

### Task 3.5:access token 管理 API

**Files:**
- Create: `src/application/access-token/access-token.controller.ts`

- [ ] **Step 1: controller**(`@RequirePermission('manage','access-token')`,后台 JWT):`POST /access-tokens`(建,返回明文)、`GET /access-tokens`(列表带明文+组名)、`POST /access-tokens/:id/revoke`。
- [ ] **Step 2: Commit** `git commit -am "🎟️ access token 后台管理 API"`

---

### Task 3.6:smoke 改造 + 端到端(阶段3 收尾)

**Files:**
- Modify: `backend/test/smoke.e2e.js`
- Modify: `src/scripts/seed-admin.ts`(可选:种子一个 demo token)

- [ ] **Step 1: smoke.e2e.js**:admin 登录 → `POST /access-tokens {name, groups:['cn-nodes'], }` 拿明文 token → invoke 用 `Authorization: Bearer <token>` 调 `cn-nodes`(命中);再调 `us-nodes`(token 无权 → 403);过期/撤销分支各测一次。
- [ ] **Step 2:** 清库重建 + build + 两个进程 + smoke:
Run: `docker compose ... down -v && sh deploy/dev-up.sh && cd backend && pnpm build && (node dist/main.js & node dist/worker.js &) && pnpm smoke`
Expected: SMOKE PASSED(含 access token 命中/403)
- [ ] **Step 3: 更新 CHANGELOG + Commit** `git commit -am "✅ 阶段3:invoke access token,组作用域/过期/撤销验证通过"`

---

## Self-Review(对照 spec)

- **spec §3 数据模型** → Tasks 1.1/2.1/3.1 覆盖(含 client_groups、RBAC 五表、access_tokens 两表、is_root、access_token_id)。✓
- **spec §4 迁移回填** → Task 1.2(脚本)+ 1.6(测试数据清库简化路径)。✓
- **spec §5 守卫** → PermissionGuard(2.3)、AccessTokenGuard(3.3)、JwtStrategy 加载(2.3)、@RequirePermission(2.3/2.4)。✓
- **spec §6 API** → 设备登录去 group(1.3)、invoke name→id(1.5)、access token CRUD(3.5)、request_logs requester(3.4)、/me(2.5)。✓
- **spec §7 种子** → 1.6 + 2.6。✓
- **spec §9 测试** → smoke 分阶段更新(1.6/2.6/3.6)。✓
- **类型一致**:PermissionTuple/AuthenticatedUser(2.2)被 guard/strategy(2.3)复用;RequestLogJob 加 accessTokenId(3.4)与 writeSpine 一致;groupIds:number[] 贯穿 presence/token。✓
- **占位符**:无 TBD/TODO;关键 contract 均给出代码。✓
