# 设备接入模型重构(device-model redesign)设计文档

> **性质:** epic 级设计北极星。定架构与决策,不含实现细节(SQL/端点级细节在各子项 spec 里)。
> **状态:** 设计已与用户对齐,待用户审阅本文档后逐子项 spec → plan → 实现。
> **生成:** 2026-07-09。

## 1. 背景 & 动机

当前设备接入是"管理员预建账户"模型:`POST /clients {clientId, secret, groups}` 预建 `clients` 账户 + `client_groups` 组成员 → 设备 `POST /api/client/login {clientId, secret}` 换 JWT → 连 WS。

问题:SDK 是**通用 build,不可能为每台设备编译**,所以设备不能靠预建的 `clientId+secret`。设备应当**自带稳定身份、自注册上来**。同时需要把"设备注册凭证"与"调用方 invoke 凭证"分开,并让"功能组"这个概念名正言顺。

## 2. 决策记录(已锁定)

| # | 决策 | 选择 | 理由 |
|---|------|------|------|
| 架构 | 三个独立概念 | PROJECT / device token / access token | 见 §3 |
| 一 | 旧 client-login(clientId+secret 预建账户) | **删除,全量替换** | 设备全走 device-token 自注册,最干净,契合通用 SDK |
| 二 | `groups` 改名 | **连库带码全改 `groups→projects`** | 概念正名,彻底 |

## 3. 目标架构:三个独立概念

```
① PROJECT(功能组)  ← 现 groups 改名。设备与两类 token 都挂到它上
      ├── access token ──(access_token_projects)── 调用方 invoke 授权:能调哪些 PROJECT
      └── device token ──(device_token_projects)── 设备注册授权:能进哪些 PROJECT

② device token(新)   专给【设备注册上线】。明文进 SDK 配置。CRUD + 显示"上了多少设备"。勾 PROJECT。
③ access token(现有,不动)  专给【调用方 invoke】。勾 PROJECT。
```

- **设备(worker)** 用 **device token** 自注册上线。
- **调用方(caller)** 用 **access token** 发起 invoke。
- 两类凭证**分表、分权、分用途**,互不越权(device token 泄露不能拿去 invoke,反之亦然)。

## 4. 目标数据模型

| 表 | 变化 | 说明 |
|---|---|---|
| `groups` → **`projects`** | 改名(库+码+迁移) | 功能组;实体表,保留 `description` + `deleted_at` |
| `access_token_groups` → **`access_token_projects`** | 改名 | 调用方 token ↔ project(M2M) |
| `access_tokens` | 不动 | invoke 调用方凭证 |
| **`device_tokens`** | 🆕 | 设备注册凭证。列见下 |
| **`device_token_projects`** | 🆕 | device token ↔ project(M2M) |
| `clients` | **删** | 预建账户模型作废 |
| `client_groups` → **`device_projects`** | 改名 **+ FK 改指 `devices`** | 设备 ↔ project;首连按 token∩能力回填 |
| `devices` | 扩列 | **唯一设备记录**(见下) |

**关键连带结论**(由决策一/二逻辑导出):
- `clients` 删 → `devices` 成为**唯一设备记录**;
- 原 `client_groups.clientId → clients.id` → 改名 `device_projects` 且 **FK 改指 `devices`**;
- 设备 project 归属不再人肉预建,而是**首连时 = device_token 授权 project ∩ 设备自报能力**。

**`device_tokens` 列**(镜像 `access_tokens` 结构,便于复用模式):
`id, name, token(明文可回看), status(active/revoked), expires_at?, description, created_by, created_at, deleted_at`;partial unique on `token where deleted_at is null`。

**`devices` 目标列**:
`id, client_id(SDK 自生成,唯一 alive), device_token_id(→ device_tokens,记由哪个 token 上来), online(bool), status(online/offline/stale 派生或落库,见子项4确认), last_seen_at, last_ip, platform, extra(jsonb/text), description, deleted_at`。

**"该 token 上了多少设备"** = `count(devices where device_token_id = ? and online)`(或 total,子项2 确认口径)。

**迁移策略(待确认):** 假定后端尚无生产数据 → 破坏式迁移(drop `clients`、rename、建新表、alter `devices`),demo 数据由 seed 重建。若有需保数据,再议数据迁移脚本。

## 5. 设备自注册流程

```
前置:管理员建 device token,勾若干 PROJECT。token 明文写进 SDK【配置】(非编译进代码)。

设备(通用 SDK)上线:
  1. 自生成 clientId(读设备稳定值,如 android_id 派生)
  2. 连 WS /api/client/ws?token=<device-token>&clientId=<自生成>
  3. 服务端校验 device token(存在/未过期/active)→ 取授权 PROJECT 集 T;失败 close(4001)
  4. 设备发首帧 register {platform, capabilities:[project...], extra?}
  5. 服务端:实际加入 = T ∩ capabilities        ← "具备这个功能才进"
       · upsert devices(client_id, device_token_id, platform, last_ip, extra, online=true, last_seen)
       · 重建 device_projects(该设备 → 加入的 project)
       · presence.online(clientId, 加入的 projectIds)
       · 回 welcome {clientId, projects}
  心跳:{heartbeat} → presence.refresh + last_seen 节流写库 → heartbeatAck
  回结果:{result,...} → registry.handleResult(不变)
  下线:presence.offline + devices.online=false(遵循缓存准则,见 §7)
```

**待审阅确认点(§5):**
- **(A) 能力上报机制**:提案用"连接后首帧 `register` 带 capabilities"(token+clientId 在 query 做鉴权,能力在首帧,避免塞 query)。备选更简:**不自报能力,加入 = token 的全部 project**(适合"该 token 下所有设备能力一致"场景)。二选一。
- **(B) welcome 时机**:提案改为"收到 register 后才 online + welcome"(register 之前连着但不进 presence)。这是相较现状的协议变化,SDK 需配合。

## 6. device token 管理

- CRUD API `/device-tokens`(生成返回明文/列表含在线设备数/改/撤销/软删),权限 `manage/device-token`(admin isRoot 直通)。
- 与 `/access-tokens` 对称;可复用 access-token 模块的模式(明文回看、redis 缓存、软删+缓存失效)。

## 7. 冷热路径 & 缓存失效(全局准则,本重构遵循)

- **热路径 presence**(invoke 派发读的 Redis 集合 `project:clients:{pid}`):由 WS 生命周期(register/心跳/断开)**主动写**。
- **权威态被动变更**(stale 扫描置离线、device token 撤销/软删、admin 操作):**删对应 Redis 键**,不 update-in-place;设备下次心跳/请求进来懒回填。
- device token 校验走 cache-aside(fail-open),撤销/删同步删缓存——照 `AccessTokenGuard` 既有模式。
- 详见记忆准则:冷热分离 + 更新即删 Redis + 懒回填,减少脏数据。

## 8. 拆分 & 顺序(epic → 子项,每块独立 spec/plan/PR)

1. **rename `groups→projects`**:`groups→projects`、`access_token_groups→access_token_projects`、全码引用、迁移。纯机械、无行为变化。**先做,后续全用新名。**(`client_groups` 留到子项3 连 FK 一起改。)
2. **device token**:`device_tokens` + `device_token_projects` + CRUD API + `manage/device-token` 权限 + 在线设备数。独立、无依赖。
3. **设备自注册 + 删 client-login**:WS 网关改 device-token 鉴权 + 自生成 id + `register` 能力交集 → upsert `devices`/`device_projects` + presence;**删 `clients`/`client_groups`(→device_projects)/`POST /clients`/`/api/client/login`/ClientService/Controller**;改 RBAC(去 `create/client`+`read/client`)、seed、smoke。**最大一块。**
4. **设备持久态**(原待办 #2 剩余):stale 扫描 worker + 设备列表/详情 API(`read/device`)+ platform/ip/extra 落齐 + `status` 口径定稿。

**⚠️ 时序铁律:** 子项3 内"删 client-login"必须在"自注册跑通"之后、同一 PR 完成,不得先删弄瘫系统。

## 9. Out of scope
- 前端管理后台(独立)。
- 指标聚合体系(待办 #3)、maxInFlight(#4)、WS 健壮性(#5/#6)、账户/分组开关(#7/#8)——不在本 epic。

## 10. 测试策略
- 每子项独立冒烟。子项3 需**重写 `test/smoke.e2e.js`**:去掉 `POST /clients`+client-login,改 device-token 建号 + 自注册上线 + invoke 闭环。
- 有 API 的走 API 验证(遵循 api-vs-pg-boundary 准则);仅 worker/无 API 面(stale 扫描)才直连 PG 冒烟。
