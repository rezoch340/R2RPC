# 2a: rename `groups → projects` 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"功能组"概念在整个后端从 `group` 彻底改名为 `project`(库 + 码 + 迁移 + Redis 键 + 权限 + WS 协议 + Manticore),无行为变化,`pnpm build/lint/smoke/retention:smoke` 全绿。

**Architecture:** 纯机械 rename,分四步:①全量 TS+schema 改名让 `pnpm build` 绿 → ②squash 破坏式重建迁移 + 重置 dev 库 + seed → ③smoke/retention-smoke 绿 → ④进度台账 + PR。这是设备接入模型重构 epic(#2)的子项 2a,先做,后续 2b/2c/2d 全用新名。

**Tech Stack:** NestJS + drizzle-orm 0.45 (`drizzle-orm/node-postgres`) + drizzle-kit 0.31 + BullMQ + Redis(ioredis)+ Manticore(mysql 协议)+ zod 配置。

## Global Constraints

- **不直接提交 main。** 已在分支 `feat/2a-rename-groups-to-projects`。功能分支 → PR → 合并。
- **提交/PR 前必须** `cd backend && pnpm format && pnpm lint && pnpm build` 全过。
- **不用 git worktree。**
- **彻底 rename**(用户 2026-07-09 决策):`request_logs.group_name→project_name`、invoke 路由 `/:group→/:project`、metrics/monitor/search/DTO/Redis 键/权限串/WS 协议全改,无 `group` 残留。
- **迁移策略 = squash 破坏式重建**(默认,用户可评审否决):删 `drizzle/*.sql`+`drizzle/meta`,从改名后 schema 重新 `db:generate` 出单个 `0000`,drop+重建 dev 库,migrate+seed。理由:破坏式迁移已批 + 彻底 rename 手写 ALTER 太大且 snapshot 易错 + 2c 还要 drop clients。**备选**(手写 ALTER RENAME)见文末附录 B。
- **`client_groups` 表不改名**(2c 删):表名 `client_groups`、TS const `clientGroups`、列 `group_id`/字段 `groupId` **全部保留**,仅把它的 FK 从 `groups.id` 指向 `projects.id`(改 import + `.references`)。
- **`migrate-groups.ts` 删除**:旧 client-login 模型的一次性回填死脚本(引用已不存在的 `clients.group_name`),连同 `package.json` 的 `migrate:groups` script 一并删。
- **别动假阳性:** `metrics.service.ts` 的 `.groupBy(...)` 是 Drizzle SQL GROUP BY 方法,不是概念,保留;Redis 键 `rpc:rr:{id}` 与 `presence:{clientId}` 无 "group" 字面,保留。

---

## 全局改名字典(所有任务共用)

**DB(物理层):**
| 旧 | 新 |
|---|---|
| 表 `groups` | 表 `projects` |
| 表 `access_token_groups` | 表 `access_token_projects` |
| 列 `access_token_projects.group_id` | 列 `project_id` |
| 列 `request_logs.group_name` | 列 `request_logs.project_name` |
| 列 `metrics.group_name` | 列 `metrics.project_name` |
| Redis 键 `group:clients:{id}` | `project:clients:{id}` |
| Manticore DDL/doc 列 `group_name` | `project_name` |

**TS 标识符 / 文件 / 路由 / 权限:**
| 旧 | 新 |
|---|---|
| 目录 `src/application/groups/` | `src/application/projects/` |
| 文件 `groups.schema.ts`/`groups.service.ts`/`groups.controller.ts`/`groups.module.ts` | `projects.*.ts` |
| 文件 `dto/create-group.dto.ts` | `dto/create-project.dto.ts` |
| const `groups`(schema) | `projects` |
| const `accessTokenGroups` | `accessTokenProjects` |
| 字段 `groupId`(access-token schema) | `projectId` |
| class `GroupsService`/`GroupsController`/`GroupsModule`/`CreateGroupDto` | `ProjectsService`/`ProjectsController`/`ProjectsModule`/`CreateProjectDto` |
| 方法 `groupsOfClient` | `projectsOfClient` |
| schema 字段 `groupName`(request_logs & metrics) | `projectName` |
| 路由 `@Controller('groups')` / `@ApiTags('groups')` | `'projects'` |
| 路由参数 `:group` / `@Param('group')` / `@Query('group')` / `req.params.group` / `req.query.group` / `?group` | `:project` / `'project'` / `req.params.project` / `?project` |
| 权限 subject `'group'`(元组 `(action,'group')`,三条 read/create/delete) | `'project'` |
| 注入 `private readonly groups: GroupsService` | `private readonly projects: ProjectsService` |
| 局部 `groupIds`/`groupId`/`groupName(s)`/`byGroup`/`_groups`/`groupRows`/`groupIdByName`/`DEMO_GROUPS`/`loginGroups`/`grps` | `projectIds`/`projectId`/`projectName(s)`/`byProject`/`_projects`/`projectRows`/`projectIdByName`/`DEMO_PROJECTS`/`loginProjects`/`projs` |
| API/DTO/JWT/WS 字段 `groups: string[]` | `projects: string[]` |
| WS 协议 job 字段 `group` / welcome `groups` | `project` / `projects` |
| `authed-request` 字段 `groupIds` | `projectIds` |

---

## Task 1: 全量 TS + schema 改名 → `pnpm build` + `pnpm lint` 绿

一次性把所有 TS 改到位(rename 不可能半改还编译,必须整体一致后才绿)。**用 `git mv` 保留历史**,再逐文件改内容。执行顺序按依赖:先 schema,再 service/module,再消费方。

**Files:**
- Rename(`git mv`): `src/application/groups/` 整目录 → `src/application/projects/`,四个 `groups.*.ts` → `projects.*.ts`,`dto/create-group.dto.ts` → `dto/create-project.dto.ts`
- Modify: `src/application/access-token/{access-token.schema.ts,access-token.service.ts,access-token.module.ts,access-token.controller.ts,dto/create-access-token.dto.ts}`
- Modify: `src/application/client/{client-groups.schema.ts,client.service.ts,client.module.ts,client.schema.ts,dto/create-client.dto.ts}`
- Modify: `src/application/rpc/{rpc.controller.ts,rpc.service.ts,rpc.module.ts}`
- Modify: `src/application/request-logs/{request-logs.schema.ts,request-logs.service.ts,request-log.types.ts,request-log.doc.ts}`
- Modify: `src/application/metrics/{metrics.schema.ts,metrics.service.ts}`
- Modify: `src/application/monitor/{monitor.controller.ts,dto/query-requests.dto.ts}`
- Modify: `src/infrastructure/ws/{ws.gateway.ts,presence.service.ts,protocol.ts}`
- Modify: `src/infrastructure/search/search.service.ts`
- Modify: `src/common/guards/access-token.guard.ts`, `src/common/types/authed-request.ts`
- Modify: `src/app.module.ts`
- Modify: `src/scripts/seed-admin.ts`
- Delete: `src/scripts/migrate-groups.ts` + `package.json` 的 `"migrate:groups"` script

**Interfaces:**
- Produces(供后续任务与 2b/2c/2d):`projects` 表 + `ProjectsService`(方法 `list/findByName/create/remove/idByName/projectsOfClient`,签名不变,仅改名);`access_token_projects(token_id, project_id)`;`request_logs.project_name`;Redis 键 `project:clients:{id}`;路由 `POST rpc/invoke/:project/:action`;权限 subject `'project'`。
- Consumes:无(第一个任务)。

- [ ] **Step 1: `git mv` 目录与文件**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
git mv src/application/groups src/application/projects
git mv src/application/projects/groups.schema.ts     src/application/projects/projects.schema.ts
git mv src/application/projects/groups.service.ts     src/application/projects/projects.service.ts
git mv src/application/projects/groups.controller.ts  src/application/projects/projects.controller.ts
git mv src/application/projects/groups.module.ts       src/application/projects/projects.module.ts
git mv src/application/projects/dto/create-group.dto.ts src/application/projects/dto/create-project.dto.ts
```

- [ ] **Step 2: 改 `projects/projects.schema.ts`**(const + 表名 + 索引名)

```ts
// 功能组(原 groups 改名)
export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 128 }).notNull(),
    description: varchar('description', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('projects_name_uq').on(t.name).where(sql`${t.deletedAt} IS NULL`),
  ],
);
```

- [ ] **Step 3: 改 `projects/projects.service.ts`**

`class GroupsService`→`ProjectsService`;`import { groups } from './groups.schema'`→`import { projects } from './projects.schema'`;正文所有 `groups`→`projects`;方法 `groupsOfClient`→`projectsOfClient`;注释"组"用词保留中文即可(非标识符)。`clientGroups` import 与用法**保留**(`clientGroups`/`clientGroups.groupId`/`clientGroups.clientId` 不动,client-groups 表 2c 才删)。改后关键行:

```ts
import { clientGroups } from '../client/client-groups.schema';
import { projects } from './projects.schema';

@Injectable()
export class ProjectsService {
  // ... list/findByName/create/remove 内 groups → projects ...
  async idByName(name: string) {
    const [g] = await this.db.select({ id: projects.id }).from(projects)
      .where(alive(projects, eq(projects.name, name))).limit(1);
    return g?.id ?? null;
  }
  // 查设备所属的所有 project(供旧设备登录签发多 project JWT 用,2c 重构)
  async projectsOfClient(clientDbId: number) {
    return this.db.select({ id: projects.id, name: projects.name })
      .from(clientGroups)
      .innerJoin(projects, alive(projects, eq(clientGroups.groupId, projects.id)))
      .where(eq(clientGroups.clientId, clientDbId));
  }
}
```

- [ ] **Step 4: 改 `projects/projects.controller.ts`**(class + 路由 + 权限 + 注入)

`GroupsController`→`ProjectsController`;`@ApiTags('groups')`→`'projects'`;`@Controller('groups')`→`'projects'`;`import { CreateGroupDto } from './dto/create-group.dto'`→`CreateProjectDto from './dto/create-project.dto'`;`import { GroupsService } from './groups.service'`→`ProjectsService from './projects.service'`;`constructor(private readonly groups: GroupsService)`→`private readonly projects: ProjectsService`;`this.groups.*`→`this.projects.*`;三处权限 `@RequirePermission('read','group')`/`('create','group')`/`('delete','group')` → subject `'project'`。

- [ ] **Step 5: 改 `projects/projects.module.ts` 与 `dto/create-project.dto.ts`**

module:`GroupsController/GroupsService/GroupsModule` 三处 → `Projects*`,import 路径 `./groups.*`→`./projects.*`。dto:`class CreateGroupDto`→`CreateProjectDto`(字段不变)。

- [ ] **Step 6: 改 `access-token/access-token.schema.ts`**

```ts
import { projects } from '../projects/projects.schema';
// ...
export const accessTokenProjects = pgTable(
  'access_token_projects',
  {
    tokenId: integer('token_id').notNull().references(() => accessTokens.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    description: varchar('description', { length: 255 }),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.projectId] })],
);
```

- [ ] **Step 7: 改 `access-token/access-token.service.ts`**

import `groups`→`projects`(`../projects/projects.schema`)、`GroupsService`→`ProjectsService`(`../projects/projects.service`)、`accessTokenGroups`→`accessTokenProjects`;注入 `groups: GroupsService`→`projects: ProjectsService`;所有局部 `groupNames/groupIds/groupName/groupId`→`projectNames/projectIds/projectName/projectId`;`this.groups.idByName`→`this.projects.idByName`;`accessTokenGroups`→`accessTokenProjects` 且 `.groupId`→`.projectId`;输入/返回字段 `groups`→`projects`;`join accessTokenProjects→projects`;`.select({ name: projects.name })`;`alive(projects, eq(accessTokenProjects.projectId, projects.id))`。返回体:`projects: projectNames`、`projects: projectNames.map(...)`、`projectIds: projectRows.map((gr) => gr.projectId)`。

- [ ] **Step 8: 改 `access-token/access-token.module.ts` + `access-token.controller.ts` + `dto/create-access-token.dto.ts`**

module:`GroupsModule`→`ProjectsModule`(`../projects/projects.module`),`imports: [ProjectsModule]`。controller:`groups: dto.groups`→`projects: dto.projects`。dto:`groups: string[]`→`projects: string[]`(同步改 `@ApiProperty`/装饰器里的字段名与示例)。

- [ ] **Step 9: 改 `client/client-groups.schema.ts`**(**只改 FK 目标**,表名/const/列全留)

```ts
import { integer, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';
import { clients } from './client.schema';
import { projects } from '../projects/projects.schema'; // ← 唯一改动:指向改名后的 projects

// 设备 ↔ 功能组 多对多(表名 client_groups 保留,2c 删)
export const clientGroups = pgTable(
  'client_groups',
  {
    clientId: integer('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), // 列名 group_id 保留,FK 指 projects
    description: varchar('description', { length: 255 }),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.groupId] })],
);
```

- [ ] **Step 10: 改 `client/client.service.ts` + `client.module.ts` + `client.schema.ts` + `dto/create-client.dto.ts`**

client.service:import `GroupsService`→`ProjectsService`(`../projects/projects.service`);注入 `groups`→`projects`;局部 `groupNames/groupIds/groupName/groupId`→`projectNames/projectIds/projectName/projectId`(`clientGroups.groupId` 赋值处保留字段名 `groupId`:`tx.insert(clientGroups).values({ clientId, groupId: projectId })`——列字段仍叫 `groupId`);`this.groups.*`→`this.projects.*`;`groupsOfClient`→`projectsOfClient`;API/JWT/返回字段 `groups`→`projects`(`groups: grps.map(...)`→`projects: projs.map(...)`,`groupNames`→`projectNames`)。client.module:`GroupsModule`→`ProjectsModule`。client.schema:注释 group→功能组(纯注释)。create-client.dto:`groups: string[]`→`projects: string[]`。

- [ ] **Step 11: 改 `rpc/rpc.controller.ts`**(路由参数 + 注入)

```ts
import { ProjectsService } from '../projects/projects.service';
// constructor: private readonly projects: ProjectsService,
@Post('rpc/invoke/:project/:action')
// summary 文案 group→功能组
invoke(@Param('project') project: string, @Param('action') action: string, /* ... */) {
  return this.rpc.invoke({ project, action, /* ... */ });
}
// online 端点:
@Query('project') project: string,
const projectId = await this.projects.idByName(project);
if (!projectId) return { project, online: [] };
return { project, online: await this.presence.listOnline(projectId) };
```

- [ ] **Step 12: 改 `rpc/rpc.service.ts`**(`InvokeParams.group`→`project`,两个下游桥接)

`import GroupsService`→`ProjectsService`;注入 `groups`→`projects`;`InvokeParams { group }`→`{ project }`;`groupId`→`projectId`,`this.groups.idByName(p.group)`→`this.projects.idByName(p.project)`;错误码字符串 `'no_group'` 保留还是改?→ **改为 `'no_project'`**(彻底,rpc 状态是内部码;注意同步 §别处若有引用,grep `no_group` 全库仅此处);`'group 内无在线设备'` 文案 group→功能组;L132 `group: p.group`→`project: p.project`(WS job,配合 protocol);L239 `group: p.project`→`project: p.project`(RequestLogJob)。

> ⚠️ `'no_group'` 是 rpc `status` 枚举值,会落 `request_logs.status` 且前端筛选可能用到。**决策:改为 `no_project`**(彻底)。执行时 grep 全库 `no_group` 确认只此一处产生 + 无硬编码消费方;若 monitor/前端有硬编码则一并改或在计划评审时降级为保留。

- [ ] **Step 13: 改 `rpc/rpc.module.ts`**

`GroupsModule`→`ProjectsModule`(`../projects/projects.module`),`imports` 内替换,注释 group→功能组。

- [ ] **Step 14: 改 `request-logs/*`**(日志列 group_name→project_name)

request-logs.schema:字段 `groupName: varchar('group_name'...)`→`projectName: varchar('project_name'...)`;三个索引里的 `t.groupName`→`t.projectName`(索引名 `req_logs_gac_created`/`req_logs_gc_created`/`req_logs_created_ga` 可保留或改,squash 会按 schema 重生,保留即可)。request-logs.service:`ListFilter.group`→`project`;SPINE select `groupName: requestLogs.groupName`→`projectName: requestLogs.projectName`;writeSpine `groupName: job.group`→`projectName: job.project`;filter `eq(requestLogs.groupName, f.group)`→`eq(requestLogs.projectName, f.project)`;retention SQL `PARTITION BY ${requestLogs.groupName}`→`${requestLogs.projectName}`;注释 `(group,action,client)`→`(project,action,client)`。request-log.types:`RequestLogJob.group`→`project`。request-log.doc:`group_name: d.group`→`project_name: d.project`。

- [ ] **Step 15: 改 `metrics/*` + `monitor/*` + `search.service.ts`**

metrics.schema:`groupName: varchar('group_name'...)`→`projectName: varchar('project_name'...)`;注释。metrics.service:`byGroup`→`byProject`,`group: requestLogs.groupName`→`project: requestLogs.projectName`,`.groupBy(requestLogs.groupName)`→`.groupBy(requestLogs.projectName)`(**注意 L28 `.groupBy(requestLogs.status)` 不动**——它本就是 status 分组),返回 `{ totals, byStatus, byProject }`。monitor.controller:`group: q.group`→`project: q.project`。query-requests.dto:`group?`→`project?`(同步 `@ApiPropertyOptional` 字段名)。search.service:Manticore DDL `group_name string`→`project_name string`。

- [ ] **Step 16: 改 `ws/*`**(protocol + gateway + presence 的 Redis 键)

protocol.ts:job 字段 `group: string`→`project: string`。ws.gateway.ts:`_groups`→`_projects`,局部 `groups`→`projects`,`payload.groups`→`payload.projects`,`socket._projects = projects`,`presence.online(clientId, projects)`,welcome `{ type:'welcome', clientId, projects }`,日志文案,`offline(clientId, projects)`。presence.service.ts:方法参数 `groupIds`→`projectIds`;**Redis 键** `` `group:clients:${gid}` ``→`` `project:clients:${gid}` ``(L25/37/55/59 四处);`pickOnline/listOnline` 参数 `groupId`→`projectId`;`rpc:rr:${projectId}` 键前缀 `rpc:rr:` 保留;`presence:${clientId}` 保留;注释 `client_groups`→`功能组`。

- [ ] **Step 17: 改 `common/guards/access-token.guard.ts` + `common/types/authed-request.ts`**

guard:`import GroupsService`→`ProjectsService`;注入 `groups`→`projects`;`groupIds`→`projectIds`;`const groupName = req.params.group ?? req.query.group`→`const projectName = req.params.project ?? req.query.project`;`this.groups.idByName(projectName)`;`t.projectIds.includes(gid)`;`req.accessToken = { id, name, projectIds: t.projectIds }`。authed-request:`groupIds: number[]`→`projectIds: number[]`。

- [ ] **Step 18: 改 `app.module.ts` + `seed-admin.ts`,删 `migrate-groups.ts`**

app.module:`import { GroupsModule } from './application/groups/groups.module'`→`ProjectsModule from './application/projects/projects.module'`,registration 里替换。seed-admin:import `groups`→`projects`(`../application/projects/projects.schema`);`DEMO_GROUPS`→`DEMO_PROJECTS`;三条权限 `subject: 'group'`→`'project'`;`.insert(groups)`→`.insert(projects)`;`groupRows`→`projectRows`,`groupIdByName`→`projectIdByName`,`groupId`→`projectId`(注意 `clientGroups.values({ clientId, groupId: projectId })` 列字段名保留 `groupId`);文案。删脚本:

```bash
git rm src/scripts/migrate-groups.ts
```

`package.json` 删掉 `"migrate:groups": "..."` 这一行。

- [ ] **Step 19: format + lint + build,验证全绿**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && pnpm format && pnpm lint && pnpm build
```
Expected: 三条全 0 退出。若报 `group` 相关的未定义/找不到模块,回到对应 Step 补齐。最后 grep 兜底(应只剩 `client_groups`/`clientGroups`/`group_id`/`groupId`/`.groupBy(`/`rpc:rr`/中文"组" 这些**故意保留**项):

```bash
grep -rniI 'group' src | grep -viE 'client_?[Gg]roup|group_id|groupId|\.groupBy\(|rpc:rr|// .*组|功能组' | sort
```
Expected: 空,或只剩你确认过的保留项。

- [ ] **Step 20: 提交 Task 1**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add -A && \
git commit -m "refactor(2a): rename groups→projects across schema + code (build green)"
```

---

## Task 2: squash 破坏式重建迁移 + 重置 dev 库 + seed

schema 已定稿,重生单个迁移并在干净库上验证。

**Files:**
- Delete: `backend/drizzle/*.sql`, `backend/drizzle/meta/*`
- Generate: `backend/drizzle/0000_*.sql` + `backend/drizzle/meta/*`(drizzle-kit 产出)
- 一次性(不入库):scratchpad 重置脚本

**Interfaces:**
- Consumes:Task 1 的改名后 schema。
- Produces:干净可迁移的 `drizzle/`,dev 库为改名后结构 + demo seed。

- [ ] **Step 1: 删旧迁移与快照**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend
git rm drizzle/*.sql
git rm -r drizzle/meta
```

- [ ] **Step 2: 从改名后 schema 重生单迁移**(空 meta → 全 CREATE,无 rename 交互 prompt)

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && pnpm db:generate
```
Expected: 生成一个 `drizzle/0000_*.sql`(含 `projects`/`access_token_projects(project_id)`/`request_logs(project_name)`/`metrics(project_name)`/`client_groups(group_id)`/`clients`/`devices`/`users`/`access_tokens` 等所有表)+ 新 `drizzle/meta/`。**无交互提问**。抽查:

```bash
grep -nE 'CREATE TABLE "(projects|access_token_projects)"' drizzle/0000_*.sql
grep -n 'project_name' drizzle/0000_*.sql
grep -n 'client_groups' drizzle/0000_*.sql   # 应含 group_id 列 + FK 指 projects
```
Expected: 命中 `projects`、`access_token_projects`、`project_name`;`client_groups.group_id` FK REFERENCES `projects`。

- [ ] **Step 3: 重置 dev 库**(破坏式;demo 数据靠 seed 重建)

写一次性重置脚本到 scratchpad(不入库),读 `config.yaml` 的库连接,DROP+CREATE public schema:

```bash
cat > /private/tmp/claude-501/-Users-lpitiless-Documents-RER0RPC/bd6c3fcf-9b15-4329-b4b2-85361c4dc229/scratchpad/reset-db.cjs <<'EOF'
const { readFileSync } = require('node:fs');
const { load } = require('js-yaml');
const { Pool } = require('pg');
const cfg = load(readFileSync('config.yaml', 'utf8')).db;
(async () => {
  const pool = new Pool(cfg);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('dev 库已重置(public schema drop+create)');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
EOF
cd /Users/lpitiless/Documents/RER0RPC/backend && node /private/tmp/claude-501/-Users-lpitiless-Documents-RER0RPC/bd6c3fcf-9b15-4329-b4b2-85361c4dc229/scratchpad/reset-db.cjs
```
Expected: `dev 库已重置`。

- [ ] **Step 4: 迁移 + seed**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && pnpm db:migrate && pnpm seed:admin
```
Expected: `迁移完成`;seed 打印管理员 + demo projects(原 `cn-nodes`/`us-nodes`)+ 权限,无报错。

- [ ] **Step 5: 验证 schema 已同步(db:generate 无残差)**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && pnpm db:generate
```
Expected: `No schema changes, nothing to migrate`(或等价"无变更")。若又生成迁移,说明 schema 与快照不一致,排查后回退多余文件。

- [ ] **Step 6: 提交 Task 2**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add -A && \
git commit -m "refactor(2a): squash migrations to fresh 0000 for projects schema"
```

---

## Task 3: smoke + retention-smoke 绿

改测试里的 `group` 字段,跑冒烟闭环。

**Files:**
- Modify: `backend/test/smoke.e2e.js`
- Modify: `backend/src/scripts/retention-smoke.ts`
- (可选)Manticore 表重建

**Interfaces:**
- Consumes:Task 1/2(改名后 API + 迁移后库)。
- Produces:两个冒烟脚本绿。

- [ ] **Step 1: 改 `test/smoke.e2e.js`**(client-login 与 access-token body 字段 `groups`→`projects`)

- create-client body `{ clientId, secret, groups: [...] }`→`{ ..., projects: [...] }`
- 读 login 响应 `cl.json.groups`→`cl.json.projects`,局部 `loginGroups`→`loginProjects`,断言文案 `client login groups include...`→`... projects include ...`
- access-token 三处 body `{ name, groups: ['cn-nodes'] }`→`{ ..., projects: ['cn-nodes'] }`(`smoke-token`/`revoke-me`/`probe-del`)
- 若 smoke 走 `rpc/invoke/:group/:action`,改成 `:project`(grep 确认 smoke 里的 invoke URL 段;当前 grep 未见硬编码 `invoke/:group`,但确认调用处 path)

- [ ] **Step 2: 改 `src/scripts/retention-smoke.ts`**(`groupName`→`projectName`)

`requestLogs.groupName`→`requestLogs.projectName`(L21/61/64 的 where),insert `groupName: TAG`→`projectName: TAG`(L28/38),注释 `group_name 打标`→`project_name 打标`。

- [ ] **Step 3:(可选)重建 Manticore 表**(列改名后)

若 dev 起了 Manticore:`search.service` 用 `CREATE TABLE IF NOT EXISTS`,旧表仍是 `group_name` 列不会自动改。删旧表让它按 `project_name` 重建(表名见 `search.service.ts` 的 `TABLE` 常量;Manticore mysql 协议默认 `:9306`):

```bash
# 用 config.yaml 的 manticore 连接;若 dev 未起 Manticore,跳过本步(payload 索引失败不阻断 smoke 主链路)
mysql -h <manticore_host> -P 9306 -e 'DROP TABLE IF EXISTS <table>;'
```

- [ ] **Step 4: 跑冒烟**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && pnpm retention:smoke
# smoke 需 API 在线:另起终端 pnpm start:api,再:
pnpm smoke
```
Expected: `RETENTION SMOKE PASSED`;smoke 全部断言 PASS(client-login 拿 projects、access-token invoke 闭环)。

- [ ] **Step 5: format + lint + build 复检 + 提交**

```bash
cd /Users/lpitiless/Documents/RER0RPC/backend && pnpm format && pnpm lint && pnpm build
cd /Users/lpitiless/Documents/RER0RPC && git add -A && \
git commit -m "test(2a): update smoke + retention-smoke to projects field names"
```

---

## Task 4: 进度台账 + PR

**Files:**
- Modify: `docs/后端进度.md`

- [ ] **Step 1: 更新 `docs/后端进度.md`**

- 总览表 `| 2a | └ rename groups→projects | 高 | ⬜ | — |` 的状态 ⬜→✅。
- epic #2 段落 2a 项标注 ✅。
- 「完成记录(倒序)」顶部加一条:

```markdown
### 2026-07-09 · #2/2a rename groups→projects — PR #<n>
- 库+码彻底改名:表 `groups→projects`、`access_token_groups→access_token_projects`(列 `group_id→project_id`)、`request_logs.group_name→project_name`、`metrics.group_name→project_name`;Redis 键 `group:clients→project:clients`;invoke 路由 `/:group→/:project`;权限 subject `group→project`;WS 协议 job/welcome 字段;Manticore `group_name→project_name`。
- Nest 模块 `groups/→projects/`(Projects{Service,Controller,Module},CreateProjectDto)。
- `client_groups` 表保留(2c 删),仅 FK 指向 `projects`;删死脚本 `migrate-groups.ts`。
- 迁移 squash 破坏式重建为单个 0000;dev 库 drop+重建+seed。
- 计划:`docs/superpowers/plans/2026-07-09-2a-rename-groups-to-projects.md`。
```

- [ ] **Step 2: 提交 + 推分支 + 开 PR**

```bash
cd /Users/lpitiless/Documents/RER0RPC && git add -A && \
git commit -m "docs(2a): mark rename groups→projects done + completion record" && \
git push -u origin feat/2a-rename-groups-to-projects && \
gh pr create --title "refactor(2a): rename groups→projects" --body "设备接入模型重构 epic(#2)子项 2a。库+码彻底 rename;client_groups 保留待 2c 删;迁移 squash 重建。计划见 docs/superpowers/plans/2026-07-09-2a-rename-groups-to-projects.md" --base main
```

- [ ] **Step 3:** 回填 PR 号到 Task 4 Step 1 的完成记录,修正后 `git commit --amend` 或补一提交。

---

## 附录 A:故意保留(rename 不碰)清单

- 表 `client_groups`、const `clientGroups`、列 `group_id`/字段 `groupId`(client-groups.schema + 其消费方)——2c 删,仅 FK 指 `projects`。
- `metrics.service.ts` L28 `.groupBy(requestLogs.status)` 与真实列引用之外的 `.groupBy` SQL 方法名。
- Redis 键 `rpc:rr:{id}`、`presence:{clientId}`(无 group 字面)。
- 中文注释里的"组/功能组"用词(非标识符)。

## 附录 B:备选迁移策略(手写 ALTER RENAME,若评审否决 squash)

不删历史,新增 `drizzle/0006_rename_groups_to_projects.sql`:

```sql
ALTER TABLE "groups" RENAME TO "projects";
ALTER INDEX "groups_name_uq" RENAME TO "projects_name_uq";
ALTER TABLE "access_token_groups" RENAME TO "access_token_projects";
ALTER TABLE "access_token_projects" RENAME COLUMN "group_id" TO "project_id";
ALTER TABLE "request_logs" RENAME COLUMN "group_name" TO "project_name";
ALTER TABLE "metrics" RENAME COLUMN "group_name" TO "project_name";
-- 视 drizzle 生成的约束/索引名再补 rename(FK 名、req_logs_* 索引)
```
代价:`drizzle/meta/0006_snapshot.json` 必须与新 schema 完全一致,否则下次 `db:generate` 出幽灵 diff——手工维护该快照易错。故默认取 squash。

---

## Self-Review

- **Spec 覆盖:** 设计文档 §8 子项1 = "groups→projects、access_token_groups→access_token_projects、全码引用、迁移;client_groups 不参与(2c 删)"。Task 1 覆盖全码 + 两表,Task 2 覆盖迁移,`client_groups` 按约保留仅改 FK。✅ 彻底口径额外覆盖 group_name/路由/Redis/权限/WS/Manticore(用户 2026-07-09 决策)。
- **类型一致:** `ProjectsService.idByName/projectsOfClient` 在 guard/rpc/client/access-token 中的调用名一致;`accessTokenProjects.projectId` 在 service 读写一致;`request_logs.projectName`/`RequestLogJob.project` 在 writeSpine/filter/doc 一致;Redis `project:clients:{id}` 在 online/offline/listOnline 一致。
- **占位扫描:** 无 TODO/TBD;每步给了 exact old→new 或代码块。`no_group→no_project` 与 Manticore 重建两处标了"执行时 grep 确认",属真实条件分支非占位。
