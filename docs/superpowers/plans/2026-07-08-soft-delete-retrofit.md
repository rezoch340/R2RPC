# 全局软删除 Retrofit 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给非日志实体表加软删除(`deleted_at` + partial unique index),删除留痕、可恢复、可重建同名;软删语义集中在 `alive()`/`softDelete()` 两个助手里(**在源头集中**,不在每个查询散写 `isNull`),并堵住"软删用户/角色仍被授权"的安全缺口。

**Architecture:** 每个非日志实体表加可空 `deleted_at`。新建 `src/common/db/soft-delete.ts` 两个表无关助手:`alive(table, ...conds)` = `and(isNull(table.deletedAt), ...conds)`,`softDelete(db, table, where)` = `update set deleted_at=now() where alive(...)` + `returning()`。所有软删表的读查询 `.where()` / join 的 ON 条件一律经 `alive()`;所有删除走 `softDelete()`。唯一约束改 `WHERE deleted_at IS NULL` 的 partial unique index。M2M 关联表与 `request_logs` 不软删。

**Tech Stack:** NestJS 11, Drizzle ORM (`NodePgDatabase`), PostgreSQL, drizzle-kit generate。

## Global Constraints

- **范围**:软删除只加到**非日志实体表**——`users` / `groups` / `clients` / `devices` / `metrics` / `roles` / `permissions` / `access_tokens`。
- **排除**:日志表 `request_logs`;所有 M2M 关联表(`client_groups` / `role_permissions` / `user_roles` / `access_token_groups`)——继续硬删关联行,**不加** `deleted_at`。
- `deleted_at` 列一律:`timestamp('deleted_at', { withTimezone: true })`(可空,无 default)。
- **软删语义唯一入口**:读过滤只经 `alive(table, ...conds)`;删除只经 `softDelete(db, table, where)`。**禁止**在 service 里散写 `isNull(x.deletedAt)` 或手写 `update...set deletedAt`——一律调助手(源头集中,漏写可 grep `alive(` / `softDelete(` 审计)。
- **软删父表不清理关联行**:父表 soft-delete 只 UPDATE,不触发 FK cascade;关联行残留由"读查询 join 父表时 `alive(父表, ON条件)`"兜住可见性,**无需**手动清 junction。
- `revoked` ≠ 删除:`access_tokens.status`(active/disabled/**revoked**)是运行状态;`deleted_at` 才是软删,二者正交——被 revoke 的 token 仍可被软删。`revoke` 改 status、`delete` 走 `softDelete`,是两个独立操作/端点。
- 唯一约束改 partial unique index,索引名规范为 `{table}_{col}_uq`;`.where()` 用 ``sql`${t.deletedAt} IS NULL` ``。
- 迁移文件走 `pnpm db:generate` 生成(编号 0005),`pnpm db:migrate` 应用;禁止手改已存在的 0000–0004。
- 验证:`pnpm build` 通过 + `pnpm smoke` 全绿(含软删专项断言)。

---

### Task 4.1: 软删助手模块 + Schema + 迁移

**Files:**
- Create: `src/common/db/soft-delete.ts`
- Modify: `src/application/users/users.schema.ts`
- Modify: `src/application/groups/groups.schema.ts`
- Modify: `src/application/client/client.schema.ts`
- Modify: `src/application/devices/devices.schema.ts`
- Modify: `src/application/metrics/metrics.schema.ts`
- Modify: `src/application/rbac/rbac.schema.ts`(仅 `roles` / `permissions` 两表)
- Modify: `src/application/access-token/access-token.schema.ts`(仅 `access_tokens` 表)
- Create: `drizzle/0005_*.sql`(由 `pnpm db:generate` 生成)

**Interfaces:**
- Produces:
  - `alive<T>(table: T, ...conds: (SQL | undefined)[]): SQL` —— 存活条件,后续任务所有读查询 `.where()` / join ON 都用它。
  - `softDelete<T>(db: NodePgDatabase, table: T, where: SQL): Promise<Record<string, any>[]>` —— 软删并 `returning()`,后续任务所有删除都用它。
  - 8 张表新增 `deletedAt` 列(TS 属性名 `deletedAt`);7 张表唯一键变 partial unique index。

**唯一约束 → partial unique index 清单(共 7):** `users.username` / `groups.name` / `clients.clientId` / `devices.clientId` / `roles.name` / `permissions(action,subject)` / `accessTokens.token`。`metrics` 无唯一约束,只加列。

- [ ] **Step 1: 建助手 `src/common/db/soft-delete.ts`**

```ts
import { and, isNull, SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';

// 软删表的最小约束:有可空 deletedAt 列
type SoftTable = PgTable & { deletedAt: PgColumn };

/**
 * 「存活」条件:isNull(deletedAt) AND 其余条件。
 * 所有针对软删表的读查询,.where() 一律经此;join 的 ON 条件也可用它,
 * 一并过滤掉被软删的父行(父表软删不 cascade 关联行,靠这里兜可见性)。
 */
export function alive<T extends SoftTable>(
  table: T,
  ...conds: (SQL | undefined)[]
): SQL {
  return and(isNull(table.deletedAt), ...conds) as SQL;
}

/**
 * 软删除:UPDATE ... SET deleted_at = now() WHERE alive(table, where)。
 * 只命中未删行(重复删返回空数组),.returning() 便于校验 NotFound / 拿行删缓存。
 * ponytail: 泛型 update().set() 拿不到 deletedAt 静态类型,此处 as any 是有意的边界转型;
 *           正确性由 build + smoke 兜底。
 */
export function softDelete<T extends SoftTable>(
  db: NodePgDatabase,
  table: T,
  where: SQL,
): Promise<Record<string, any>[]> {
  return db
    .update(table)
    .set({ deletedAt: new Date() } as any)
    .where(alive(table, where))
    .returning() as unknown as Promise<Record<string, any>[]>;
}
```
(若 `PgColumn` / `PgTable` 的确切导出路径在本版本不同,以 `pnpm build` 报错为准修正 import;类型约束不通过时可放宽为 `PgTable & { deletedAt: any }`。)

- [ ] **Step 2: 改 8 个 schema**

`deletedAt` 列(每表新增,加在 `createdAt` 附近):
```ts
deletedAt: timestamp('deleted_at', { withTimezone: true }),
```

单列唯一 → partial index(以 `users` 为例):去掉列上的 `.unique()`,在表定义第二参数加 partial index。需从 `drizzle-orm/pg-core` 引入 `uniqueIndex`,从 `drizzle-orm` 引入 `sql`:
```ts
import { boolean, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: varchar('username', { length: 64 }).notNull(), // 去掉 .unique()
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    role: varchar('role', { length: 32 }).notNull().default('admin'),
    isRoot: boolean('is_root').notNull().default(false),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_username_uq').on(t.username).where(sql`${t.deletedAt} IS NULL`)],
);
```
同法:
- `groups`:去 `name.unique()` → `uniqueIndex('groups_name_uq').on(t.name).where(sql\`${t.deletedAt} IS NULL\`)` + `deletedAt`。
- `clients`:去 `clientId.unique()` → `uniqueIndex('clients_client_id_uq').on(t.clientId).where(...)` + `deletedAt`。
- `devices`:去 `clientId.unique()` → `uniqueIndex('devices_client_id_uq').on(t.clientId).where(...)` + `deletedAt`。
- `metrics`:只加 `deletedAt`(无唯一约束,不加 index)。
- `roles`:去 `name.unique()` → `uniqueIndex('roles_name_uq').on(t.name).where(...)` + `deletedAt`。
- `permissions`:把 `unique('perm_action_subject_uq').on(t.action, t.subject)` 改成 `uniqueIndex('perm_action_subject_uq').on(t.action, t.subject).where(sql\`${t.deletedAt} IS NULL\`)`;`unique` 不再用则从 import 去掉,补 `uniqueIndex`;加 `deletedAt`。
- `access_tokens`:去 `token.unique()` → `uniqueIndex('access_tokens_token_uq').on(t.token).where(...)` + `deletedAt`。

**不动**:`access_token_groups` / `client_groups` / `role_permissions` / `user_roles` / `request_logs`。

- [ ] **Step 3: 生成迁移 + 核对**

Run: `pnpm db:generate`
生成 `drizzle/0005_*.sql`,**打开核对**:含 8 个 `ADD COLUMN "deleted_at"`;7 处 `DROP CONSTRAINT ..._unique`(或 `DROP INDEX perm_action_subject_uq`)后 `CREATE UNIQUE INDEX ... WHERE "deleted_at" IS NULL`;**未**触碰 `request_logs` 与 4 张 junction 表。若 drizzle-kit 交互式追问 rename,选 create(非 rename)。SQL 错则改 schema 删掉坏的 0005 重新生成。

- [ ] **Step 4: 应用迁移 + 构建**

Run: `pnpm db:migrate && pnpm build`
Expected: 迁移应用成功,build 通过。(docker PG 已起。)

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(soft-delete): alive()/softDelete() helpers + deleted_at + partial unique (0005)"
```

---

### Task 4.2: users / groups / clients 服务软删除 + 读过滤(走助手)

**Files:**
- Modify: `src/application/users/users.service.ts`
- Modify: `src/application/groups/groups.service.ts`
- Modify: `src/application/client/client.service.ts`

**Interfaces:**
- Consumes: `alive` / `softDelete`(`src/common/db/soft-delete.ts`);`users/groups/clients.deletedAt`。
- Produces: 三域 delete 变软删、所有读经 `alive()`。`groups.remove` 后同名可重建。

统一 import:`import { alive, softDelete } from '../../common/db/soft-delete';`(路径按各文件层级调整)。现有 `eq` 保留。

- [ ] **Step 1: users.service**
```ts
// findByUsername:
.where(alive(users, eq(users.username, username)))
// findById:
.where(alive(users, eq(users.id, id)))
// list:
.from(users).where(alive(users))
// remove:
async remove(id: number) {
  await softDelete(this.db, users, eq(users.id, id));
  return { deleted: true };
}
```

- [ ] **Step 2: groups.service**
```ts
// list:
.from(groups).where(alive(groups))
// findByName:
.where(alive(groups, eq(groups.name, name)))
// idByName:
.where(alive(groups, eq(groups.name, name)))
// groupsOfClient(join ON 用 alive 过滤被删组):
.innerJoin(groups, alive(groups, eq(clientGroups.groupId, groups.id)))
.where(eq(clientGroups.clientId, clientDbId))
// remove:
async remove(id: number) {
  await softDelete(this.db, groups, eq(groups.id, id));
  return { deleted: true };
}
```

- [ ] **Step 3: client.service**(无 delete 操作,只过滤读)
```ts
// findByClientId:
.where(alive(clients, eq(clients.clientId, clientId)))
// list:
.from(clients).where(alive(clients))
```

- [ ] **Step 4: 构建**

Run: `pnpm build`  → PASS。

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat(soft-delete): users/groups/clients via alive()/softDelete()"
```

---

### Task 4.3: rbac.service 软删除 + JwtStrategy 拒已删用户/角色(走助手)

**Files:**
- Modify: `src/application/rbac/rbac.service.ts`
- Modify: `src/application/auth/jwt.strategy.ts`

**Interfaces:**
- Consumes: `alive` / `softDelete`;`roles/permissions/users.deletedAt`。
- Produces: `RbacService.findAuthUser(id)` → `{ id, isRoot } | null`(过滤已删);`getUserPermissions` 排除经软删角色/软删权限授予的权限;`deleteRole`/`deletePermission` 软删。

**安全要点**:软删用户/角色的关联行(user_roles/role_permissions)不清理,读不过滤 = 已删用户 JWT 仍被授权、已删角色仍在授权。必须在 `getUserPermissions` 的 join ON 用 `alive()`,并在 JwtStrategy 拒已删用户。

import:`import { alive, softDelete } from '../../common/db/soft-delete';`。现有 `and, eq` 保留。

- [ ] **Step 1: rbac.service**

`getUserPermissions`(join ON 经 alive 过滤软删角色 + 软删权限):
```ts
async getUserPermissions(userId: number): Promise<PermissionTuple[]> {
  return this.db
    .selectDistinct({ action: permissions.action, subject: permissions.subject })
    .from(userRoles)
    .innerJoin(roles, alive(roles, eq(userRoles.roleId, roles.id)))
    .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(permissions, alive(permissions, eq(rolePermissions.permissionId, permissions.id)))
    .where(eq(userRoles.userId, userId));
}
```

新增 `findAuthUser`(替代 JwtStrategy 里的 `isRoot`,顺带"存在且未删"校验):
```ts
async findAuthUser(id: number): Promise<{ id: number; isRoot: boolean } | null> {
  const [u] = await this.db
    .select({ id: users.id, isRoot: users.isRoot })
    .from(users)
    .where(alive(users, eq(users.id, id)))
    .limit(1);
  return u ?? null;
}
```
`isRoot(userId)` 方法:先 `grep -rn "\.isRoot(" src`(排除 users.schema 的列 isRoot)。确认除 JwtStrategy 外无调用方 → 删除该方法。若有其它调用方,保留并给其查询包 `alive(users, eq(users.id, userId))`。

`listRoles` / `listPermissions` / `assertRoleExists` / `assertPermissionExists` / `assertUserExists` 读过滤 + `deleteRole` / `deletePermission` 软删:
```ts
// listRoles:
.from(roles).where(alive(roles))
// listPermissions:
.from(permissions).where(alive(permissions))
// assertRoleExists:
.where(alive(roles, eq(roles.id, id)))
// assertPermissionExists:
.where(alive(permissions, eq(permissions.id, id)))
// assertUserExists:
.where(alive(users, eq(users.id, id)))
// deleteRole:
async deleteRole(id: number) {
  const [row] = await softDelete(this.db, roles, eq(roles.id, id));
  if (!row) throw new NotFoundException('角色不存在');
  return { deleted: true };
}
// deletePermission:
async deletePermission(id: number) {
  const [row] = await softDelete(this.db, permissions, eq(permissions.id, id));
  if (!row) throw new NotFoundException('权限不存在');
  return { deleted: true };
}
```
**不改**:`createRole`/`createPermission` 的 `onConflictDoNothing()`(partial index 下仍工作;软删同名后可重建是预期);attach/detach/assign/unassign 走 junction 硬删,不动。

- [ ] **Step 2: jwt.strategy**
```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
async validate(payload: JwtPayload) {
  const id = Number(payload.sub);
  const user = await this.rbac.findAuthUser(id);
  if (!user) throw new UnauthorizedException('账号不存在或已删除');
  const permissions = await this.rbac.getUserPermissions(id);
  return { id, sub: payload.sub, username: payload.username, permissions, isRoot: user.isRoot };
}
```

- [ ] **Step 3: 构建**  → `pnpm build` PASS。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(soft-delete): rbac soft-delete + exclude deleted roles/perms; JwtStrategy rejects deleted users"
```

---

### Task 4.4: access-token 软删除(独立 delete,与 revoke 正交,走助手)

**Files:**
- Modify: `src/application/access-token/access-token.service.ts`
- Modify: `src/application/access-token/access-token.controller.ts`

**Interfaces:**
- Consumes: `alive` / `softDelete`;`accessTokens.deletedAt`。
- Produces: `AccessTokenService.delete(id)`(软删 + 删 redis 缓存);`list`/`findByToken` 过滤已删;`DELETE /access-tokens/:id` 端点。已删 token → `findByToken` 返 null → guard **401**(区别 revoke 的 403)。

import:`import { alive, softDelete } from '../../common/db/soft-delete';`。现有 `eq` 保留。

- [ ] **Step 1: access-token.service**
```ts
// list:
const tokens = await this.db.select().from(accessTokens).where(alive(accessTokens));
// findByToken:
.where(alive(accessTokens, eq(accessTokens.token, token)))
// 新增 delete(软删 + 同步删缓存;已删 token 必须立即失效):
async delete(id: number) {
  const rows = await softDelete(this.db, accessTokens, eq(accessTokens.id, id));
  if (rows.length === 0) {
    throw new NotFoundException('Token 不存在');
  }
  const row = rows[0];
  if (row?.token) {
    const key = `invoke:token:${createHash('sha256').update(row.token).digest('hex')}`;
    try {
      await this.redis.client.del(key);
    } catch {
      // fail-open: 缓存删失败不阻断,最长 60s 自然过期
    }
  }
  return { deleted: true };
}
```
`revoke` 保持不变(改 status)。

- [ ] **Step 2: access-token.controller** —— 加 `DELETE /:id`,与 revoke 同权限声明:
```ts
@Delete(':id')
@RequirePermission('manage', 'access-token')
@ApiOperation({ summary: '删除 access token(软删,与撤销正交)' })
delete(@Param('id', ParseIntPipe) id: number) {
  return this.tokens.delete(id);
}
```
确保 `Delete` / `Param` / `ParseIntPipe` 已从 `@nestjs/common` 引入。

- [ ] **Step 3: 构建**  → `pnpm build` PASS。

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "feat(soft-delete): access-token soft-delete op + DELETE endpoint (orthogonal to revoke)"
```

---

### Task 4.5: smoke 专项断言 + seed 复验

**Files:**
- Modify: `test/smoke.e2e.js`

**Interfaces:**
- Consumes: 前 4 个任务的全部行为。

**目标**:纯 HTTP/WS(不直连 DB)证明软删语义。复用现有 smoke 的登录/建实体流程,追加:

- [ ] **Step 1: 追加软删断言**(现有断言之后,用 admin token / 管理 API):
  1. **partial unique 重建 + 软删即失效**:建 access token `probe-del-<随机>`(现有建 token API,勾一个已存在组)→ `DELETE /access-tokens/:id` → 用该 token invoke 应 **401**(证软删即失效,区别 revoke 的 403)→ **同名再建 token 成功**(证 partial unique:旧删除行不挡同名)。
  2. 保留现有全部断言不回归。
  实现前先 `grep -n "access-tokens\|invoke\|revoke\|http(" test/smoke.e2e.js` 摸清辅助函数/端点用法,复用其 `http()`/断言风格;端点路径以现有 controller 为准(`grep -rn "@Controller\|@Post\|@Delete" src/application/access-token`)。

- [ ] **Step 2: seed 幂等复验 + 跑 smoke**

Run: `pnpm seed:admin && pnpm smoke`
Expected: seed 幂等无报错(`onConflictDoNothing` 在 partial index 下仍工作);smoke **全绿**,含新增软删断言。

- [ ] **Step 3: Commit**
```bash
git add -A && git commit -m "test(soft-delete): smoke asserts token soft-delete→401 + partial-unique rebuild"
```

---

## Self-Review 备忘(计划作者已核)

- 覆盖:助手模块 ✅;8 表加列 ✅;7 partial index ✅;users/groups/clients/rbac/access-token 读过滤 + 软删全走 `alive`/`softDelete` ✅;JwtStrategy 拒已删用户 ✅;getUserPermissions 排除已删角色/权限 ✅;access-token 独立 delete ✅;smoke 验证 ✅。
- 排除项一致:`request_logs` + 4 张 junction 全程不动 ✅。
- 类型一致:`alive`/`softDelete` 在 4.1 定义、4.2–4.4 消费;`findAuthUser` 返回类型在 4.3 定义、jwt.strategy 消费 ✅。
- 源头集中:service 内禁散写 `isNull(deletedAt)`/手写 softDelete,一律调助手(可 grep 审计)✅。
- 已知非目标:软删父表不清 junction 残留(靠读 join 的 `alive()` 兜底)。
