# #7: 用户 enabled + last_login_at 实现计划

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(推荐)。Steps 用 `- [ ]`。

**Goal:** users 加 `enabled`(禁用登录 + 每请求吊销)+ `last_login_at`(登录更新);`POST /users/:id/enabled` 启停;列表暴露二者。

**Architecture:** enabled 双重执行——**登录时**(auth.service 查密码后拦禁用)+ **每请求**(jwt.strategy.validate 本就每请求重查用户 `rbac.findAuthUser`,加 enabled 检查近零成本,可立即吊销禁用用户的已发 JWT)。last_login 登录成功后异步更新。启停端点镜像 #8 的 `projects/:id/enabled`。

**Tech Stack:** NestJS 11 · drizzle · passport-jwt。

## Global Constraints
- 已在分支 `feat/7-user-enabled-lastlogin`。功能分支 → PR → 合并。
- 提交/PR 前(`backend/`,**不用 `pnpm <script>`**,直接 `node_modules/.bin/{...}`):build+lint+format 全过。
- 迁移增量(纯 ADD COLUMN,非交互)。
- seed admin **不改**(enabled default true,admin 自动 enabled)。

## File Structure
- Modify `src/application/users/users.schema.ts` — 加 `enabled` + `last_login_at`。
- Modify `src/application/users/users.service.ts` — `updateLastLogin`/`setEnabled`;list/detail 暴露 enabled+last_login。
- Modify `src/application/users/users.controller.ts` — `POST /:id/enabled`。
- Modify `src/application/users/dto/` — `SetEnabledDto`(或复用 projects 的)。
- Modify `src/application/auth/auth.service.ts` — 登录 enabled 检查 + last_login。
- Modify `src/application/rbac/rbac.service.ts` — `findAuthUser` 带 enabled。
- Modify `src/application/auth/jwt.strategy.ts` — validate 每请求 enabled 拦。
- Modify `src/scripts/seed-admin.ts` — `update/user` 权限。
- Modify `test/smoke.e2e.js`。
- 新迁移 `0007_*.sql`。

---

## Task 1: users.schema enabled+last_login + 迁移 + update/user 权限

- [ ] **Step 1: users.schema 加两列**(`isRoot` 之后)

import 确认有 `boolean`;加:
```ts
    isRoot: boolean('is_root').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
```

- [ ] **Step 2: seed-admin 加 update/user 权限**

`ALL_PERMISSIONS` 在 `{ action: 'delete', subject: 'user' },` 之后加:
```ts
  { action: 'delete', subject: 'user' },
  { action: 'update', subject: 'user' },
```

- [ ] **Step 3: 生成+应用迁移+reseed+build**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
node_modules/.bin/drizzle-kit generate
grep -nE 'ADD COLUMN "(enabled|last_login_at)"' drizzle/0007_*.sql
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/migrate.ts
node_modules/.bin/ts-node -r tsconfig-paths/register src/scripts/seed-admin.ts 2>&1 | tail -1
node_modules/.bin/nest build 2>&1 | tail -3
```
Expected:2 个 ADD COLUMN(非交互);迁移完成;seed「权限 16 条」;build 0。

- [ ] **Step 4: 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src/application/users/users.schema.ts backend/src/scripts/seed-admin.ts backend/drizzle && git commit -m "feat(7): users.enabled + last_login_at columns + update/user permission + migration"
```

---

## Task 2: enabled/last_login 全线接线

**Files:** `users.service.ts`, `users.controller.ts`, `dto/set-enabled.dto.ts`, `auth.service.ts`, `rbac.service.ts`, `jwt.strategy.ts`。

- [ ] **Step 1: UsersService 加 updateLastLogin + setEnabled;list/detail 暴露 enabled+last_login**

`cat src/application/users/users.service.ts` 核对。加:
```ts
  async updateLastLogin(id: number) {
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, id));
  }

  async setEnabled(id: number, enabled: boolean) {
    const [row] = await this.db
      .update(users)
      .set({ enabled })
      .where(alive(users, eq(users.id, id)))
      .returning({ id: users.id, username: users.username, enabled: users.enabled });
    if (!row) throw new NotFoundException('用户不存在');
    return row;
  }
```
并在现有 `list()`/`findById()` 的 select 里补 `enabled: users.enabled, lastLoginAt: users.lastLoginAt`(暴露给后台展示)。`NotFoundException`/`alive`/`eq` 按需 import。

- [ ] **Step 2: 建 `dto/set-enabled.dto.ts`**(或从 projects 复制)

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}
```

- [ ] **Step 3: UsersController 加启停端点**(镜像 `projects.controller` 的 `POST :id/enabled`)

`cat src/application/users/users.controller.ts`,加:
```ts
  @Post(':id/enabled')
  @RequirePermission('update', 'user')
  @ApiOperation({ summary: '启用/停用用户(停用后禁止登录且立即吊销现有会话)' })
  setEnabled(@Param('id', ParseIntPipe) id: number, @Body() dto: SetEnabledDto) {
    return this.users.setEnabled(id, dto.enabled);
  }
```
import 补 `Post`/`Body`/`ParseIntPipe`(若缺)+ SetEnabledDto。

- [ ] **Step 4: auth.service 登录 enabled 检查 + last_login**

`login()` 里,密码校验通过之后、签 JWT 之前加 enabled 检查;签完 JWT、return 之前更新 last_login:
```ts
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (!user.enabled) {
      throw new ForbiddenException('账号已禁用');
    }
    const token = await this.jwt.signAsync({ sub: user.id, username: user.username });
    await this.users.updateLastLogin(user.id);
    return { token, user: { id: user.id, username: user.username, role: user.role } };
```
import 补 `ForbiddenException`。`findByUsername` 返回全行(含 enabled),无需改它。

- [ ] **Step 5: rbac.findAuthUser 带 enabled + jwt.strategy 每请求拦**

`rbac.service.ts` `findAuthUser` 的 select 加 `enabled: users.enabled`,返回类型加 `enabled: boolean`。
`jwt.strategy.ts` `validate()` 里,`findAuthUser` 返回后 null 检查之下加:
```ts
    const user = await this.rbac.findAuthUser(id);
    if (!user) throw new UnauthorizedException('账号不存在或已删除');
    if (!user.enabled) throw new ForbiddenException('账号已禁用');
```
import 补 `ForbiddenException`。

- [ ] **Step 6: build + lint + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/nest build 2>&1 | tail -5 && node_modules/.bin/eslint "src/application/{users,auth,rbac}/**/*.ts"
cd /Users/lpitiless/Documents/RER0RPC && git add backend/src && git commit -m "feat(7): enforce user enabled (login + per-request revoke) + last_login update + toggle endpoint"
```

---

## Task 3: 冒烟

**Files:** `test/smoke.e2e.js`。

- [ ] **Step 1: 加断言**(在现有 RBAC/op1 段之后——op1 用户已建、有 token)

```ts
  // #7:用户 enabled 启停 + last_login
  const usersList2 = await http('GET', '/users', null, admin);
  const op1row = (usersList2.json || []).find((u) => u.username === 'op1');
  assert(!!op1row && op1row.enabled === true, 'op1 默认 enabled=true');
  // 停用 op1 -> 其现有 token 立即失效(每请求拦)+ 新登录被拒
  const disableU = await http('POST', `/users/${op1row.id}/enabled`, { enabled: false }, admin);
  assert(disableU.status < 300 && disableU.json.enabled === false, '停用 op1');
  const opReq = await http('GET', '/auth/me', null, opToken); // opToken 是 op1 之前登录拿的
  assert(opReq.status === 403, '停用后 op1 现有 token 访问 -> 403(每请求吊销)');
  const opLogin2 = await http('POST', '/auth/login', { username: 'op1', password: 'oppass123' });
  assert(opLogin2.status === 403, '停用后 op1 重新登录 -> 403');
  // 复原
  await http('POST', `/users/${op1row.id}/enabled`, { enabled: true }, admin);
  const opLogin3 = await http('POST', '/auth/login', { username: 'op1', password: 'oppass123' });
  assert(opLogin3.status < 300 && !!opLogin3.json.token, '启用后 op1 可再登录');
  const adminRow = (usersList2.json || []).find((u) => u.username === 'admin');
  assert(adminRow && (adminRow.lastLoginAt === null || typeof adminRow.lastLoginAt === 'string'), 'users 列表含 lastLoginAt 字段');
```
> `opToken`/`admin` 变量在 smoke 前面 RBAC 段已建(admin 登录、op1 登录拿 opToken)。执行时 `cat test/smoke.e2e.js` 确认 `opToken` 名字与作用域。若 `/auth/me` 停用后返 401(而非 403)也接受——按实际返回(401/403 皆表示被拦)调整断言为 `>= 400`。

- [ ] **Step 2: build + 起 API + 跑 smoke**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
node_modules/.bin/nest build 2>&1 | tail -2
pkill -f 'node dist/main.js' 2>/dev/null; sleep 1
node dist/main.js > /tmp/api-7.log 2>&1 &
for i in $(seq 1 25); do curl -s -o /dev/null -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123456"}' && break; sleep 1; done
node test/smoke.e2e.js 2>&1 | tail -25
pkill -f 'node dist/main.js' 2>/dev/null
```
Expected:全 PASS + `SMOKE PASSED`,含用户启停/吊销/last_login 断言。FAIL 别提交。

- [ ] **Step 3: prettier + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && node_modules/.bin/prettier --write "test/**/*.js" >/dev/null
cd /Users/lpitiless/Documents/RER0RPC && git add backend/test/smoke.e2e.js && git commit -m "test(7): user enabled toggle + per-request revoke + last_login smoke"
```

---

## Task 4: 进度台账 + PR

**Files:** `docs/后端进度.md`。

- [ ] **Step 1: 台账 #7 → ✅ + 完成记录**

- 总览表 `#7` ⬜→✅;#7 段落标注完成。
- 完成记录顶部加:
```markdown
### 2026-07-09 · #7 用户 enabled + last_login_at — PR #<n>
- users 加 `enabled`(启停)+ `last_login_at`;迁移 `0007`。`POST /users/:id/enabled`(`update/user` 权限,→16 条)。
- enabled **双重执行**:登录时(auth.service 密码后拦禁用 403)+ **每请求**(jwt.strategy.validate 经 rbac.findAuthUser 重查,禁用立即吊销现有 JWT)。登录成功更新 last_login_at;list/detail 暴露 enabled+last_login。
- 验证:build/lint/format 绿;e2e smoke 停用→现有 token 403 + 重登 403 + 启用后可登 + last_login 字段断言全绿。
- 计划:`docs/superpowers/plans/2026-07-09-7-user-enabled-lastlogin.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add docs/后端进度.md && git commit -m "docs(7): mark user enabled + last_login done" && git push -u origin feat/7-user-enabled-lastlogin && gh pr create --base main --title "feat(7): 用户 enabled + last_login_at" --body "users 启停(登录+每请求双重拦)+ last_login。POST /users/:id/enabled。计划见 docs/superpowers/plans/2026-07-09-7-user-enabled-lastlogin.md"
```

- [ ] **Step 3:** 回填 PR 号,补一提交。

---

## Self-Review
- **双重执行**:登录拦(auth.service)+ 每请求拦(jwt.strategy,复用既有 findAuthUser 重查,近零成本)→ 禁用立即生效不等 token 过期。
- **last_login**:登录成功后 `updateLastLogin`;list/detail 暴露。
- **启停端点**:`POST /users/:id/enabled`(`update/user`),镜像 #8。
- **seed 不改**:enabled default true,admin 自动 enabled(不会锁死自己)。
- **类型一致**:`setEnabled(id,bool)`/`updateLastLogin(id)`;`findAuthUser` 返回加 `enabled`;jwt.strategy 消费一致。
- **边界**:root 用户也受 enabled 约束(policy:admin 别把自己/唯一管理员停用,DB 可救——注明)。
