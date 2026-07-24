# 历史归档：旧版 Go R0RPC 核心功能统计

> 本文是重写时使用的旧系统语义基线，不代表当前实现。当前能力矩阵见 `../RER0RPC-核心功能统计.md`。

> 目的：把现有 Go 实现的**功能语义**完整拆出来，供用任意语言重写。本文只描述「系统做什么、协议长什么样、数据怎么存」，不绑定 Go。所有默认值、字段名、状态值均取自源码。
> 现状一句话：**单节点、内存态的 RPC 中继服务器** —— 客户端（设备）通过 WebSocket 常驻在线，管理端/调用方通过 HTTP 发起一次 RPC，服务端在同 group 内把请求派发给某个在线客户端、等结果、回传，并把每次调用落库 + 聚合统计，配一个 7 页管理控制台。

---

## 1. 核心概念模型

| 概念 | 是什么 | 标识 | 关系 |
|---|---|---|---|
| **User（账户）** | 登录账户，分 `admin` / `client` 两种角色 | `username`（唯一） | admin 管控台；client 账户用于设备登录。admin 天然拥有 client 权限。 |
| **Group（分组）** | 调用寻址 + 负载均衡的单位 | `name`（唯一，≤128 字符，禁含 `/ \ ? #`） | 一个 group 下挂多个 client。可启用/禁用。 |
| **Client / Device（客户端/设备）** | 一台接入的设备。Device=持久身份（落库），Client/Session=运行态（WS 会话） | `clientId`（全局唯一） | 属于某 user + 某 group。同一 clientId 同时只允许一条活跃 WS，新连接挤掉旧连接。 |
| **Session（会话）** | WS 连接存续期间的内存运行态：待发队列、在途计数、group 游标 | clientId | 连接断开即销毁并标记设备离线。 |
| **Request（RPC 请求）** | 一次调用记录 | `requestId`（唯一） | 由调用方发起，派发给某 client，有状态和耗时。 |

**两层「在线」概念**（重写时务必分清）：
- **运行态在线** = 内存里有该 clientId 的活跃 WS 会话。**派发只认这一层**。
- **持久态在线** = 数据库 `devices.status='online'` 且 `last_seen_at` 足够新。**查询/展示用这一层**。

---

## 2. 数据模型（MySQL，utf8mb4 / utf8mb4_unicode_ci，InnoDB，6 张表）

库名 `r0rpc`。以下每张表给出**完整字段（名 / 类型 / 含义）+ 主键 / 唯一 / 外键 / 全部索引 + 写入方式**，可直接照抄建表。

### 2.1 `users` — 账户
登录账户，区分 admin / client 角色，控制是否可发起 RPC。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | BIGINT 自增 | 主键 |
| `username` | VARCHAR(64) NOT NULL UNIQUE | 用户名（唯一） |
| `password_hash` | VARCHAR(255) NOT NULL | bcrypt 密码哈希 |
| `role` | ENUM('admin','client') 默认 'client' | 角色 |
| `enabled` | TINYINT(1) 默认 1 | 是否启用（禁用则无法登录） |
| `can_rpc` | TINYINT(1) 默认 1 | 是否允许发起 RPC |
| `notes` | VARCHAR(255) 默认 '' | 备注 |
| `last_login_at` | DATETIME NULL | 最后登录（登录成功 `NOW()` 更新） |
| `created_at` | DATETIME 默认 CURRENT_TIMESTAMP | 创建时间 |
| `updated_at` | DATETIME ON UPDATE CURRENT_TIMESTAMP | 更新时间 |

- 主键 `id`；唯一 `username`；索引 `idx_users_role_enabled (role, enabled)`
- 被引用：`devices.user_id → users.id`

### 2.2 `groups` — 分组元数据
分组的启停状态与备注。表名是保留字，SQL 里用反引号 `` `groups` ``。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | BIGINT 自增 | 主键 |
| `name` | VARCHAR(128) NOT NULL UNIQUE | 分组名（唯一，业务上等同 `group_name`） |
| `enabled` | TINYINT(1) 默认 1 | 是否启用 |
| `notes` | VARCHAR(255) 默认 '' | 备注 |
| `created_at` | DATETIME 默认 CURRENT_TIMESTAMP | 创建时间 |
| `updated_at` | DATETIME ON UPDATE CURRENT_TIMESTAMP | 更新时间 |

- 主键 `id`；唯一 `name`；索引 `idx_groups_enabled_name (enabled, name)`
- `name` **不是外键**，其它表用字符串 `group_name` 关联。首次建库会从 `devices` / `rpc_requests` / 两张 metrics 表 `INSERT IGNORE` 回填已存在的分组名。
- 分组名校验：非空、≤128 字符、不含 `/ \ ? #`。

### 2.3 `devices` — 设备 / 在线状态
一个 client（设备）一行，记录归属用户、分组、平台、在线状态与最后活跃信息。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | BIGINT 自增 | 主键 |
| `client_id` | VARCHAR(128) NOT NULL UNIQUE | 设备唯一标识（业务主键，UPSERT 冲突键） |
| `user_id` | BIGINT NOT NULL | 归属用户，外键 → `users.id` |
| `group_name` | VARCHAR(128) NOT NULL | 所属分组名 |
| `platform` | VARCHAR(64) 默认 'xposed' | 客户端平台 |
| `status` | ENUM('online','offline') 默认 'offline' | 在线状态 |
| `last_seen_at` | DATETIME 默认 CURRENT_TIMESTAMP | 最后上报/心跳时间 |
| `last_ip` | VARCHAR(64) 默认 '' | 最后来源 IP |
| `extra_json` | LONGTEXT NULL | 设备上报的附加 JSON（extra map） |
| `created_at` | DATETIME 默认 CURRENT_TIMESTAMP | 创建时间 |
| `updated_at` | DATETIME ON UPDATE CURRENT_TIMESTAMP | 更新时间 |

- 主键 `id`；唯一 `client_id`；外键 `fk_devices_user (user_id) → users(id)`
- 索引：`idx_devices_group_status (group_name,status)`、`idx_devices_group_last_seen (group_name,last_seen_at)`、`idx_devices_group_status_last_seen (group_name,status,last_seen_at)`、`idx_devices_status_last_seen (status,last_seen_at)`、`idx_devices_user (user_id)`、`idx_devices_last_seen (last_seen_at)`
- 在线辅助：Redis `presence:<client_id>`（值=group_name，TTL 2min）；`MarkStaleDevicesOffline` 把 `last_seen_at < offlineBefore` 且非 offline 的批量置 offline。

### 2.4 `rpc_requests` — 原始请求记录（最细粒度，会被定期清理/裁剪的主表）
每一次 RPC 调用一行，含请求/响应载荷、状态、耗时。

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | BIGINT 自增 | 主键 |
| `request_id` | VARCHAR(64) NOT NULL UNIQUE | 请求唯一 ID（UPSERT 冲突键） |
| `group_name` | VARCHAR(128) NOT NULL | 分组名 |
| `action_name` | VARCHAR(128) NOT NULL | 动作名 |
| `client_id` | VARCHAR(128) NOT NULL | 目标设备 |
| `requester_user_id` | BIGINT NULL | 发起请求的用户 id |
| `request_payload_json` | LONGTEXT NULL | 请求载荷 JSON |
| `response_payload_json` | LONGTEXT NULL | 响应载荷 JSON |
| `status` | ENUM('pending','success','error','timeout','no_client','rejected') 默认 'pending' | 请求状态 |
| `http_code` | INT 默认 200 | HTTP 状态码 |
| `latency_ms` | BIGINT 默认 0 | 耗时（毫秒） |
| `error_message` | VARCHAR(255) 默认 '' | 错误信息 |
| `created_at` | DATETIME 默认 CURRENT_TIMESTAMP | 创建时间 |
| `finished_at` | DATETIME NULL | 完成时间（完成时写 `NOW()`） |

- 主键 `id`；唯一 `request_id`
- 索引：`idx_rpc_requests_lookup (group_name,action_name,client_id,created_at)`、`idx_rpc_requests_group_client_created (group_name,client_id,created_at)`、`idx_rpc_requests_client_created (client_id,created_at)`、`idx_rpc_requests_action_created (action_name,created_at)`、`idx_rpc_requests_created_group_action (created_at,group_name,action_name)`、`idx_rpc_requests_created_at (created_at)`、`idx_rpc_requests_status (status)`
- 写入：`CreateRPCRequest`（初始 pending）与 `CompleteRPCRequest(s)`（批量，每语句最多 128 行）均为 `INSERT ... ON DUPLICATE KEY UPDATE`，以 `request_id` 去重。

### 2.5 `device_daily_metrics` — 设备维度日聚合
按「天 × 设备 × 分组」聚合请求量与耗时。用于周报/日报/趋势。

| 字段 | 类型 | 含义 |
|---|---|---|
| `stat_date` | DATE NOT NULL | 统计日期（联合主键） |
| `client_id` | VARCHAR(128) NOT NULL | 设备（联合主键） |
| `group_name` | VARCHAR(128) NOT NULL | 分组（联合主键） |
| `total_requests` | BIGINT 默认 0 | 总请求数 |
| `success_requests` | BIGINT 默认 0 | 成功数 |
| `failed_requests` | BIGINT 默认 0 | 失败数 |
| `timeout_requests` | BIGINT 默认 0 | 超时数 |
| `total_latency_ms` | BIGINT 默认 0 | 总耗时（算均值用） |
| `max_latency_ms` | BIGINT 默认 0 | 最大耗时 |
| `updated_at` | DATETIME ON UPDATE CURRENT_TIMESTAMP | 更新时间 |

- 复合主键 `(stat_date, client_id, group_name)`
- 索引：`idx_device_daily_metrics_client_date (client_id,stat_date)`、`idx_device_daily_metrics_group_date (group_name,stat_date)`
- 累加写入：`total_latency_ms += VALUES`、`max_latency_ms = GREATEST(...)`。

### 2.6 `rpc_daily_metrics` — 动作维度日聚合
按「天 × 分组 × 动作 × 设备」聚合。比 device 表多一个 `action_name` 维度；`client_id` 可为空串 `''` 表示不区分设备的聚合。

| 字段 | 类型 | 含义 |
|---|---|---|
| `stat_date` | DATE NOT NULL | 统计日期（联合主键） |
| `group_name` | VARCHAR(128) NOT NULL | 分组（联合主键） |
| `action_name` | VARCHAR(128) NOT NULL | 动作（联合主键） |
| `client_id` | VARCHAR(128) 默认 '' | 设备（联合主键，可空串） |
| `total_requests` | BIGINT 默认 0 | 总请求数 |
| `success_requests` | BIGINT 默认 0 | 成功数 |
| `failed_requests` | BIGINT 默认 0 | 失败数 |
| `timeout_requests` | BIGINT 默认 0 | 超时数 |
| `total_latency_ms` | BIGINT 默认 0 | 总耗时 |
| `max_latency_ms` | BIGINT 默认 0 | 最大耗时 |
| `updated_at` | DATETIME ON UPDATE CURRENT_TIMESTAMP | 更新时间 |

- 复合主键 `(stat_date, group_name, action_name, client_id)`
- 索引：`idx_rpc_daily_metrics_group_date (group_name,stat_date)`、`idx_rpc_daily_metrics_action_date (action_name,stat_date)`、`idx_rpc_daily_metrics_client_date (client_id,stat_date)`

### 2.7 领域对象 ↔ 表 映射
| 结构体 | 对应 | 说明 |
|---|---|---|
| `User` | ↔ `users` | 字段一一对应；`password_hash` 不序列化（JSON tag `-`）；`last_login_at` 可空 |
| `Device` | ↔ `devices` | `GroupName` 的 JSON tag 是 `group`；`extra_json` 读取时 `COALESCE(...,'')` |
| `RPCRequest` | ↔ `rpc_requests` | `RequesterUserID`/`FinishedAt` 可空；`GroupName`→`group`、`ActionName`→`action` |
| `RequestFilterOptions` | 查询辅助（无表） | 从 `rpc_requests` 取去重下拉选项（且要求分组/设备在 `devices` 中存在） |
| `RPCRequestPage` | 分页容器（无表） | `items/page/pageSize/total/totalPages` |
| `DailyMetric` | ↔ `device_daily_metrics` 一行 | `stat_date` 格式 `YYYY-MM-DD` |
| `WeeklyMetric` | 由 `device_daily_metrics` 近 7 天聚合 | `avgLatencyMs = SUM(total_latency)/SUM(total)`、`maxLatencyMs = MAX(max_latency)` |
| `GroupInfo` | ↔ `groups` + 派生统计 | `totalDevices/onlineDevices/lastSeenAt` 由 devices 聚合；`requests7d/success7d/lastRequestAt` 由 rpc_daily_metrics 近 7 天聚合；`successRate = success7d*100/requests7d`；`status/statusLabel` 运行时派生（见枚举） |
| `TrendPoint` | 由 `rpc_daily_metrics` 按天聚合 | `avgLatencyMs = total_latency/total`、`successRate = success*100/total`；缺失日期补零值点 |

### 2.8 保留 / 聚合策略（默认值）
- **`rpc_requests` 按天清理**：`CleanupOldRequests` 删 `created_at < NOW()-INTERVAL N DAY`，默认 **3 天**（`RAW_RETENTION_DAYS`）。
- **`rpc_requests` 按 scope 裁剪**：`TrimAllRPCRequestScopes` 按 `(group_name,action_name,client_id)` 每组只保留最新 `keep` 条（`ORDER BY created_at DESC,id DESC`），默认 **100 条**（`RAW_REQUEST_KEEP_LATEST_PER_SCOPE`）。
- **两张日聚合表按天清理**：`CleanupOldMetrics` 删 `stat_date < 今天-(N-1)`，默认保留 **30 天**（`AGGREGATE_RETENTION_DAYS`）。
- **重启对账**：`RebuildRecentDeviceMetricsFromRequests` 在事务里删掉近 N 天 `device_daily_metrics` 再从 `rpc_requests`（排除 pending）重新 GROUP BY 回填，默认窗口 3 天。
- **无物化「周表」**：`WeeklyMetrics` 直接在 `device_daily_metrics` 上 `stat_date >= CURDATE()-6` 实时 GROUP BY；`ClientDailyMetrics/TrendMetrics` 默认 7 天、上限 30 天；`GroupSummary(hours)` 直接在 `rpc_requests` 上按最近 N 小时聚合，默认 24h。
- **分状态计数口径**（写聚合时）：`status=='success'`→success；`=='timeout'`→timeout；**其余一律 failed**（含 error/no_client/rejected/pending）。

### 2.9 枚举 / 状态值汇总
- **`users.role`**：`admin`、`client`
- **账户开关**：`enabled`(1/0)、`can_rpc`(1/0)
- **`devices.status`**：`online`、`offline`
- **`rpc_requests.status`**：`pending`、`success`、`error`、`timeout`、`no_client`、`rejected`
- **`GroupInfo.status`**（运行时派生，非 DB 列）：`disabled`(禁用) / `no_device`(无设备) / `online`(有在线设备) / `stale`(最后活跃早于 7 天前) / `offline`(其余)
- **`devices.platform`**：非枚举，VARCHAR，默认 `xposed`

---

## 3. 客户端接入 & WebSocket RPC 协议（系统的核心）

> 本节所有 JSON 字段名逐字取自 Go `json` struct tag，大小写即线上真实值。应用层消息一律 UTF-8 JSON，走 WS **文本帧 (opcode 0x1)**，时间字段为 RFC3339（`Job.createdAt/deadlineAt` 为 RFC3339Nano）。

### 3.0 全局约定速查
| 项 | 值 |
|---|---|
| WS 端点 | `GET /api/client/ws?token=<token>` |
| 单消息上限（收发双向强制） | `4<<20` = **4194304 字节 (4 MiB)** |
| 分片帧 | **不支持**，收到 `FIN=0` 直接断开 |
| 帧掩码 | server→client **不加掩码**；client→server 应按 RFC6455 加掩码（服务端按 mask bit 解掩码） |
| 每帧写超时 | 15s |
| 读超时（=心跳/离线超时） | 默认 **20s**（`DEVICE_OFFLINE_SECONDS`），每次读消息前重置 |
| 服务端 WS ping 间隔 | 默认 **5s**（`HEARTBEAT_INTERVAL_SECONDS`） |
| HTTP 客户端接口鉴权 | `Authorization: Bearer <token>`；WS 用 `?token=` |

### 3.1 第一步：`POST /api/client/login`（公开，账号密码换 token）

要求用户 `role=client`（admin 也放行）且 `can_rpc=true`；分组须已创建且启用。请求：
```json
{
  "username": "device-user",
  "password": "device-secret",
  "clientId": "dev-0001",
  "group": "payment",
  "platform": "android",
  "maxInFlight": 512,
  "extra": { "appVersion": "1.4.2", "region": "cn" }
}
```
| 字段 | 类型 | 说明 |
|---|---|---|
| `username`/`password` | string | 必填 |
| `clientId` | string | 必填，设备唯一 ID，调度按此寻址 |
| `group` | string | 必填，所属分组 |
| `platform` | string | 可选，缺省 `"xposed"` |
| `maxInFlight` | int | 可选；服务端夹取到 `[256,1024]`（≤0→配置默认，<256→256，>1024→1024） |
| `extra` | object | 可选，任意 JSON，透传落库到 `extra_json` |

响应 200（`token` 为 client JWT，有效期 **24h**；`maxInFlight` 是夹取后的实际值）：
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy",
  "user": { "id": 12, "username": "device-user", "role": "client", "enabled": true, "canRpc": true, "notes": "", "createdAt": "2026-06-01T00:00:00Z", "updatedAt": "2026-07-08T10:00:00Z" },
  "group": "payment",
  "maxInFlight": 512,
  "transport": "websocket",
  "wsUrl": "ws://your-host:8080/api/client/ws?token=eyJ...yyy"
}
```
`transport` 恒为 `"websocket"`；`wsUrl` 已拼好 token（`url.QueryEscape` 转义），scheme 依 `X-Forwarded-Proto=https`/TLS 判 `ws`/`wss`，host 取 `X-Forwarded-Host` 或 `r.Host`。
**状态码**：200；400 body 解析失败；401 凭证无效/账号禁用/无 RPC 权限/缺 clientId 或 group；403 分组被禁用；404 分组不存在。

### 3.2 第二步：WebSocket 升级（手写 RFC6455）

token 走 `?token=`（也支持 `Authorization: Bearer`，query 优先），claims.role 必须 `client`。客户端请求头：
```http
GET /api/client/ws?token=eyJ...yyy HTTP/1.1
Host: your-host:8080
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```
服务端 101 响应（**只回这 3 个头**）：
```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```
`Sec-WebSocket-Accept = base64( SHA1( Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" ) )`。
**升级前置校验**（任一不满足→400 不升级）：`Connection` 含 `upgrade`、`Upgrade` 含 `websocket`、`Sec-WebSocket-Version` 严格等于 `13`、`Sec-WebSocket-Key` 非空。鉴权失败→401；分组不可用→404/403。
连上后**不需要再发注册消息**，服务端立即主动下发 `welcome`。

**opcode 处理**：收 ping(0x9)→自动回 pong(0xA)；收 pong→刷新在线后忽略（**客户端必须对服务端每 5s 的 ping 回 pong，否则 20s 读超时断开**）；收 close(0x8)→按 EOF 关闭；收 text(0x1)→按 JSON 信封解析；其它 opcode 忽略。

### 3.3 消息信封 `wsEnvelope`（收发共用，按 `type` 区分）

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | 类型判别键，**无 omitempty，永远出现** |
| `job` | object(omitempty) | 仅 `type=job` |
| `result` | object(omitempty) | 客户端上报结果时 |
| `requestId` | string(omitempty) | 请求关联 ID |
| `ok` | bool(omitempty) | ⚠**值为 `false` 时被省略，只有 `true` 才出现** |
| `state` | string(omitempty) | resultAck 状态 accepted/rejected/error |
| `error` | string(omitempty) | 错误文本 |
| `clientId`/`group`/`serverId`/`time`/`maxInFlight` | (omitempty) | welcome 用 |

> 所有业务字段带 omitempty，实际 JSON 只出现该类型用到的字段。**没有独立的「上线/离线」消息**：上线=收到 welcome；离线=WS 断开。

### 3.4 各消息类型（真实 JSON 示例）

**`welcome`（S→C，连接建立即下发一次）**
```json
{ "type": "welcome", "clientId": "dev-0001", "group": "payment", "serverId": "r0rpc-node-1", "time": "2026-07-08T10:30:00Z", "maxInFlight": 512 }
```

**`job`（S→C，有任务时推送）** — `job` 展开为 `rpc.Job`：
```json
{
  "type": "job",
  "job": {
    "requestId": "req-8f3c1a2b",
    "group": "payment",
    "action": "queryOrder",
    "clientId": "dev-0001",
    "payload": { "orderId": "A100086" },
    "createdAt": "2026-07-08T10:30:05.123456Z",
    "deadlineAt": "2026-07-08T10:30:35.123456Z"
  }
}
```
`Job` 字段：`requestId`(回结果必须原样带回) · `group` · `action` · `clientId`(被指派的设备) · `payload`(json.RawMessage，原始透传，空则 `null`) · `createdAt` · `deadlineAt`(过期任务在派发/入队时丢弃，零值=无截止)。五个非时间字段无 omitempty，恒出现。

**`heartbeat`（C→S，可选，与 WS ping/pong 独立）** `{ "type": "heartbeat" }`
**`heartbeatAck`（S→C）** `{ "type": "heartbeatAck", "time": "2026-07-08T10:30:10Z" }`

**`result`（C→S，上报任务结果）** — `result` 展开为 `rpc.JobResult`：
```json
{
  "type": "result",
  "result": {
    "requestId": "req-8f3c1a2b",
    "status": "success",
    "httpCode": 200,
    "payload": { "orderId": "A100086", "status": "PAID", "amount": 1999 },
    "error": "",
    "latencyMs": 42
  }
}
```
`JobResult` 字段：`requestId`(必须=job 的，空/未匹配会被拒) · `status`(空字符串→服务端补 `"success"`) · `httpCode`(透传给上游) · `payload`(json.RawMessage；压缩时放 base64 字符串，见 3.5) · `payloadEncoding`(omitempty) · `payloadRawSize`/`payloadCompressedSize`(omitempty，仅元信息不校验) · `error`(恒出现) · `latencyMs`(int64)。

**`resultAck`（S→C）** — `state` 三态：
```json
{ "type": "resultAck", "requestId": "req-8f3c1a2b", "ok": true, "state": "accepted" }
```
```json
{ "type": "resultAck", "requestId": "req-8f3c1a2b", "state": "rejected", "error": "request result client mismatch" }
```
（rejected/error 时 `ok=false` 被 omitempty 省略，所以**没有 `ok` 字段**）

| state | 触发 |
|---|---|
| `accepted` | 结果成功投递给等待方（或判定重复/迟到但已消化） |
| `rejected` | ① payloadEncoding 非法/压缩数据坏；② `ErrResultClientMismatch`（requestId 归属别的 clientId） |
| `error` | 其它错误，如 `ErrResultNotWaiting`（请求已不在等待） |

特例：`type=result` 但 `result` 缺失/null → `{ "type": "resultAck", "error": "result payload required" }`

**`error`（S→C，信封级错误）** `{ "type": "error", "error": "invalid json payload" }`
触发：入站文本帧 JSON 解析失败→`invalid json payload`；未知 type→`unsupported message type`。

### 3.5 payload 压缩（`payloadEncoding`）
- 唯一合法值 `"gzip+base64+json"`；空字符串=不压缩，`payload` 按原始 JSON 透传；其它值报错 `unsupported payloadEncoding: <值>`（WS→resultAck rejected；HTTP→400）。
- **客户端编码**：结果对象序列化 JSON 字节 → gzip 压缩 → 标准 base64 → 把 base64 字符串放进 `payload`（**此时 payload 是字符串不是对象**），`payloadEncoding="gzip+base64+json"`。
- **服务端解码**：payload 反序列化为字符串（非字符串→`compressed payload must be base64 string`）→ base64 解码 → gunzip → TrimSpace →空则置 `{}`，否则 `json.Valid` 校验（不合法→`decoded payload is not valid json`）→ 替换 `payload` 为明文 JSON 并清空 `payloadEncoding`（下游永远拿到明文）。

### 3.6 HTTP 长轮询降级通道（同一套 Job/JobResult，可选实现）
三接口均需 `Authorization: Bearer <token>`。
- **`POST /api/client/poll?waitSeconds=N`**（N ≤0 或 >55 → 20；范围 1..55）→ 有任务 `{"job":{...同 Job...}}`，超时无任务 `{"job":null}`。分组不可用 404/403，其它 400。
- **`POST /api/client/result`** → body 即 JobResult 各字段 → `{"ok":true}`。状态码：400 `requestId required`/body 坏/encoding 非法；**409 `request result client mismatch`**（clientId 不匹配）；404/403 分组不可用；500 其它（如 `ErrResultNotWaiting`）。
- **`POST /api/client/logout`**（无 body）→ 注销会话 + 标记设备离线 → `{"ok":true}`。

### 3.7 一次完整往返时序（WS 主链路）
1. `POST /api/client/login` → 拿 `token` + `wsUrl`
2. `GET /api/client/ws?token=...` → 服务端 `101 Switching Protocols`
3. 收 `welcome`；之后每 5s 收 WS ping，须回 pong
4. 收 `job`（上游 `/rpc/invoke` 命中本分组/设备时）
5. 在 `deadlineAt` 前回 `result`（原样带回 `requestId`）
6. 收 `resultAck`（`state:accepted`）→ 结果被投递回等待的上游调用方，闭环
> HTTP 降级等价：步骤 4 换 `poll` 拿 `{"job":{...}}`，步骤 5 换 `result`，步骤 6 换 `{"ok":true}`。

### 3.8 心跳与离线判定（默认值）
| 项 | 默认 | 说明 |
|---|---|---|
| 服务端 WS ping 间隔 | **5s**（`HEARTBEAT_INTERVAL_SECONDS`） | 保活主力 |
| 读超时 / 离线判定 | **20s**（`DEVICE_OFFLINE_SECONDS`） | 20s 内收不到任何帧（含 pong）→ 读超时 → 断连 → 判离线 |
| presence 落库节流 | **5s**（`PRESENCE_FLUSH_SECONDS`） | 收到消息刷新 last_seen，但对 DB 最多每 5s 写一次 |
| Redis presence TTL | **2min** | 键 `presence:<clientId>`=groupName；登录 SET、心跳 EXPIRE 续期、离线 DEL |

离线三种触发：① WS 断开（含被挤掉/logout）立即置 offline；② 20s 读超时；③ 后台清扫把 `last_seen_at` 超阈值的批量置 offline。

---

## 4. RPC 调度链路（一次「手动调用」的完整流程）

**入口** `POST /rpc/invoke/{group}/{action}`，body `{username,password,clientId,payload,timeoutSeconds}`（clientId 可空=不指定目标）。

1. 生成 requestId，校验分组 active。
2. 定超时：默认 **25s**（`REQUEST_TIMEOUT_SECONDS`），若请求带 `timeoutSeconds∈(0,120)` 则覆盖。算出 deadlineAt。
3. 异步登记一条 `pending` 记录（不阻塞）。
4. **选目标会话**：
   - 指定了 clientId → 直接取；不在线 → `no_client`。
   - 未指定 → 在该 group 内**轮询（round-robin，带游标）**挑一个队列未满的会话；全组无人→`no_client`；有人但队列全满→`rejected`。
5. 登记 waiter（requestId→结果 channel），把 job 推入该 client 的 FIFO 队列（满→`rejected`；job 已过期直接丢）。
6. **派发协程**：受 `maxInFlight` 限制占一个在途槽 → 出队 → WS 发 `{type:job}`；发送失败则释放槽 + job 回退重排。
7. 客户端执行后回 `{type:result}`。
8. **回收**：命中 waiter 且 clientId 匹配 → 删 waiter、释放在途槽、结果塞回 channel；不匹配→`rejected`；迟到/重复结果通过一张保留 **10min** 的 completed 表识别（`completed`/`expired`/`late`）。
9. invoke 阻塞在「结果 channel 或超时」上返回，再把结果/错误映射为 HTTP：

| 结果 | status | HTTP |
|---|---|---|
| 成功 | success | 200 |
| 超时 | timeout | **504** |
| 无在线/指定设备掉线 | no_client | **502** |
| 队列满/组饱和 | rejected | **429** |
| 分组不存在 | group_not_found | 404 |
| 分组禁用 | group_disabled | 403 |

---

## 5. 后台管理 HTTP API（25 个路由）

**鉴权**：JWT（HS256，密钥=`JWT_SECRET`）。Claims：`{userId, username, role, clientId, group, maxInFlight}` + 标准声明（jti/sub/iat/exp）。校验顺序：`Authorization: Bearer` 头 → Cookie `r0rpc_admin_token`（HttpOnly, SameSite=Lax）→ WS 额外支持 `?token=`。**admin 可访问所有 client 接口，client 不能访问 admin 接口**。admin token 有效期 12h，client token 24h。
**响应格式**：`Content-Type: application/json; charset=utf-8`；错误统一 `{"error":"<message>"}`；写操作统一 `{"ok":true}`；时间字段序列化为 RFC3339，`*time.Time` 为空时（omitempty）整字段省略。

### 5.0 响应结构体字段名速查（json tag —— 照抄别改大小写）
| 结构体 | 字段（tag → 类型） |
|---|---|
| `User` | `id`i64 · `username`s · `role`s · `enabled`b · `canRpc`b · `notes`s · `lastLoginAt`s(omitempty) · `createdAt`s · `updatedAt`s（`password_hash` 为 `json:"-"`，永不输出） |
| `Device` | `id`i64 · `clientId`s · `userId`i64 · `group`s · `platform`s · `status`s · `lastSeenAt`s · `lastIp`s · `extraJson`s · `createdAt`s · `updatedAt`s |
| `GroupInfo` | `group`s · `enabled`b · `notes`s · `totalDevices`i64 · `onlineDevices`i64 · `requests7d`i64 · `success7d`i64 · `lastSeenAt`s(omitempty) · `lastRequestAt`s(omitempty) · `status`s · `statusLabel`s · `successRate`f64 · `createdAt`s · `updatedAt`s |
| `RPCRequest` | `id`i64 · `requestId`s · `group`s · `action`s · `clientId`s · `requesterUserId`i64(omitempty) · `requestPayload`s · `responsePayload`s · `status`s · `httpCode`i · `latencyMs`i64 · `errorMessage`s · `createdAt`s · `finishedAt`s(omitempty) |
| `RPCRequestPage` | `items`[]RPCRequest · `page`i · `pageSize`i · `total`i64 · `totalPages`i |
| `RequestFilterOptions` | `groups`[]s · `actions`[]s · `clientIds`[]s |
| `WeeklyMetric` | `clientId`s · `group`s · `totalRequests`/`successRequests`/`failedRequests`/`timeoutRequests`/`avgLatencyMs`/`maxLatencyMs` 均 i64 |
| `DailyMetric` | `statDate`s · `clientId`s · `group`s · `totalRequests`/`successRequests`/`failedRequests`/`timeoutRequests`/`totalLatencyMs`/`maxLatencyMs` 均 i64 |
| `TrendPoint` | `statDate`s · `totalRequests`/`successRequests`/`failedRequests`/`timeoutRequests`/`avgLatencyMs`/`maxLatencyMs` i64 · `successRate`f64 |

> ⚠**大小写陷阱**：group 字段的 tag 是 **`group`**（不是 groupName）；`RPCRequest` 里错误字段是 **`errorMessage`**，但 invoke 响应里是 **`error`**；invoke 结果成功标志是下划线 **`is_ok`**；权限字段是 **`canRpc`**。`requestPayload`/`responsePayload` 在 API 里是**字符串**（内含 JSON 串），不是嵌套对象。

---

### 5.1 公开

**`GET /` / `GET /static/{file...}`** — 前端首页 / 静态资源（防 `..` 穿越，全部 `Cache-Control: no-store`；**无 SPA fallback**，非 `/` 未知路径 404）。

**`GET /healthz`** → 200：
```json
{ "status": "ok", "name": "r0rpc", "serverId": "srv-01", "time": "2026-07-08T10:00:00Z" }
```

**`POST /api/auth/login`**（公开）→ 请求 `{"username":"admin","password":"secret123"}`；成功 200 返回 `{token, user:User}`（token 12h）并下发 `Set-Cookie: r0rpc_admin_token=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`。状态码：200；400 body 坏；401 凭证无效/账号禁用/非 admin。
```json
{ "token": "eyJhbGciOi...", "user": { "id": 1, "username": "admin", "role": "admin", "enabled": true, "canRpc": true, "notes": "", "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-07-08T10:00:00Z" } }
```

### 5.2 账户管理（admin）

**`GET /api/users`** → `{"items":[User,...]}`（按 id 降序；`lastLoginAt` 空则省略）。
**`POST /api/users`** → 请求 `{username, password, role="client", enabled, canRpc, notes}`（role 只能 admin/client）；成功 **201** 直接返回 `User`（不包 items）。400：body 坏/role 非法/`username already exists`。
**`PATCH /api/users/{id}/status`** → path `id`i64；请求 `{"enabled":false,"canRpc":true}`（两字段一起传）→ `{"ok":true}`。400 id 非整数/body 坏。
**`PATCH /api/users/{id}/password`** → 请求 `{"password":"newpass456"}`（不能空）→ `{"ok":true}`。400 `password required`。

### 5.3 分组管理（admin）

**`GET /api/groups`** → `{"items":[GroupInfo,...]}`，叠加实时在线覆盖 `onlineDevices/status/statusLabel/lastSeenAt`。`status`∈`disabled/no_device/online/stale/offline`，`successRate` 为百分比 0–100：
```json
{ "items": [ { "group": "payments", "enabled": true, "notes": "", "totalDevices": 12, "onlineDevices": 3, "requests7d": 5400, "success7d": 5310, "lastSeenAt": "2026-07-08T09:59:00Z", "lastRequestAt": "2026-07-08T09:58:00Z", "status": "online", "statusLabel": "Online", "successRate": 98.33, "createdAt": "2026-06-01T00:00:00Z", "updatedAt": "2026-07-08T00:00:00Z" } ] }
```
**`POST /api/groups`** → 请求 `{name, group(name 的别名), enabled(*bool 默认 true), notes}`；成功 **201** 返回 `GroupInfo`（仅 group/enabled/notes/时间有值，统计字段为零）。400：名称空/含 `/ \ ? #`/超 128/`group already exists`。
**`PATCH /api/groups/{name}/status`** → path `name`；请求 `{"enabled":false}` → `{"ok":true}`。404 分组不存在。

### 5.4 设备（admin）

**`GET /api/devices`** → query `group` `client` `status`(实时状态叠加后过滤，大小写不敏感) `limit`(默认 100，>200 或 ≤0 归 100) → `{"items":[Device,...]}`（status 经实时会话覆盖为 online/offline）：
```json
{ "items": [ { "id": 10, "clientId": "dev-abc", "userId": 2, "group": "payments", "platform": "xposed", "status": "online", "lastSeenAt": "2026-07-08T09:59:50Z", "lastIp": "203.0.113.9", "extraJson": "{\"model\":\"Pixel\"}", "createdAt": "2026-06-10T00:00:00Z", "updatedAt": "2026-07-08T09:59:50Z" } ] }
```

### 5.5 监控（admin）

**`GET /api/monitor/requests`** → query `group` `action` `client` `status` `page`(默认 1) `pageSize`(默认 20，≤0 或 >100 归 20) → 顶层即 `RPCRequestPage`：
```json
{ "items": [ { "id": 999, "requestId": "a1b2c3d4e5f6", "group": "payments", "action": "getBalance", "clientId": "dev-abc", "requesterUserId": 1, "requestPayload": "{\"clientId\":\"\",\"timeoutSeconds\":0,\"payload\":{\"acct\":\"123\"}}", "responsePayload": "{\"is_ok\":true,\"data\":{\"balance\":10}}", "status": "success", "httpCode": 200, "latencyMs": 42, "errorMessage": "", "createdAt": "2026-07-08T09:50:00Z", "finishedAt": "2026-07-08T09:50:00Z" } ], "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
```
**`GET /api/monitor/request-options`** → query `group` `action` `client`(联动过滤，每类最多 200) → 顶层即 `RequestFilterOptions` `{groups, actions, clientIds}`（都是 []string）。
**`GET /api/monitor/groups/summary`** → query `hours`(默认 24) → `items` 为 map 数组，字段 `group, action, total, success, timeout, avgLatencyMs`（均按 group+action 汇总，avgLatencyMs 取整）。

### 5.6 指标（admin）

**`GET /api/metrics/clients/weekly`** → query `group` `client` → `{"items":[WeeklyMetric,...]}`（近 7 天 `CURDATE()-6` 按 client+group 汇总）。
**`GET /api/metrics/clients/{clientId}/daily`** → path `clientId`；query `days`(默认 7，≤0 或 >30 归 7) → `{"items":[DailyMetric,...]}`（按 statDate 降序，`statDate` 格式 `YYYY-MM-DD`）。
**`GET /api/metrics/trends`** → query `group` `action` `client` `days`(默认 7，上限 30) → `{"items":[TrendPoint,...]}`（按日期**升序，长度恒=days，缺失日期补零点**；`avgLatencyMs`=总延迟/总请求整除，`successRate`=成功/总×100）。

### 5.7 客户端接入（见 §3 完整协议）
`POST /api/client/login` · `GET /api/client/ws` · `POST /api/client/poll` · `POST /api/client/result` · `POST /api/client/logout` —— 请求/响应 JSON、握手、消息类型见第 3 节。

### 5.8 RPC 调用

**`GET /rpc/clientQueue`**（**未挂 requireRole**，仅校验分组已创建且启用）→ query `group`(**必填**，缺失 400 `group required`) `status`(缺省只返 online) `limit`(默认 100，>200 归 100)：
```json
{ "group": "payments", "count": 1, "clientIds": ["dev-abc"], "items": [ { "clientId": "dev-abc", "group": "payments", "platform": "xposed", "status": "online", "lastSeenAt": "2026-07-08T09:59:50Z", "lastIp": "203.0.113.9", "pendingCount": 0, "inFlight": 2, "maxInFlight": 512 } ] }
```

**`POST /rpc/invoke/{group}/{action}`**（需 admin：`Authorization: Bearer` 头 **或** body 内 `username`+`password`，账密路径带 12h 内存缓存）→ path `group` `action`；请求 `InvokeRequest`：
```json
{ "clientId": "dev-abc", "timeoutSeconds": 30, "payload": { "acct": "123" } }
```
（`clientId` 空=Hub 自选目标；`timeoutSeconds` >0 且 <120 时生效，否则用默认 25s；`payload` 任意 JSON）

**成功 200**（手拼 map，注意 `is_ok` 下划线）：
```json
{ "is_ok": true, "requestId": "a1b2c3d4e5f6", "group": "payments", "action": "getBalance", "clientId": "dev-abc", "requestPayload": { "acct": "123" }, "status": "success", "httpCode": 200, "data": { "balance": 10 }, "latencyMs": 42, "error": "" }
```
（`is_ok`=status==success 且 error 空；`data`=设备回传 payload，空则 `{}`；`httpCode` 来自设备结果）

**失败**（body 与成功版不同：无 `data`/`latencyMs`，有 `status`/`httpCode`/`error`）：
```json
{ "is_ok": false, "status": "no_client", "httpCode": 502, "requestId": "a1b2c3d4e5f6", "group": "payments", "action": "getBalance", "clientId": "", "requestPayload": { "acct": "123" }, "error": "no online client" }
```

| 场景 | HTTP | body `status` |
|---|---|---|
| 成功 | 200 | `success`（来自设备结果） |
| 分组不存在 | 404 | `group_not_found` |
| 分组被禁用 | 403 | `group_disabled` |
| 超时（含 context deadline） | 504 | `timeout` |
| 无在线 / 指定 client 掉线 | 502 | `no_client` |
| client 队列满 / 分组饱和 | 429 | `rejected` |
| 其它调用失败 | 502 | `failed` |
| 鉴权失败 / body 非空且解析失败 | 401 / 400 | —（`{"error":...}`） |

**通用约定**：列表类返回 `{items:[...]}`；写操作 `{ok:true}`；创建 201+资源本身；只有 `/api/monitor/requests` 分页；排序全在 SQL 层写死，接口不暴露排序参数。`invoke`/`clientQueue` 响应是 handler 手拼的 `map[string]any`，不对应 model 结构体，字段名以本节为准。

---

## 6. 管理控制台（7 个页面）

> **前端底座现状**（都可替换，本节只列功能语义）：纯原生 JS 单页，无框架、无第三方库，图表是手绘 Canvas 2D（`drawBarChart`/`drawLineChart`）。7 个页面靠切换 `.hidden` 显示。

**全局机制**：
- **登录**：`#loginPanel` 表单（用户名默认 `admin` + 密码）→ `POST /api/auth/login`（不带 token）→ 成功存 `localStorage`（`r0rpc_token`=token、`r0rpc_user`=user JSON）→ 换成 `#sessionCard`。每个鉴权请求带 `Authorization: Bearer <token>`。任何请求 **401 自动登出**并踢回登录页。`invalid credentials` 翻译成 “Invalid username or password”。
- **实时机制**：**没有 WebSocket/SSE，纯 REST + 定时轮询**（`AUTO_REFRESH_MS` `setInterval`）。每次轮询先 `GET /healthz` 再重载当前页。页面 `hidden` 时暂停，`visibilitychange` 变可见时立即刷一次。顶栏 `#serverMeta` 显示 `服务器 ID: {serverId} / {name}`（来自 /healthz）。
- 各页轮询间隔：overview **10s** · groups **5s** · clients **5s** · devices **15s** · requests / users / invoke **不自动刷新**（仅手动刷新按钮）。

---

### 6.1 总览 overview（轮询 10s）
**用途**：按 group/action/client 过滤看近 N 天请求量/成功率/延迟趋势看板。
**数据源**：`loadOverview()` 并发 3 个请求 —— `GET /api/metrics/trends?group&action&client&days`（趋势）+ `GET /api/groups`（健康度统计）+ `GET /api/monitor/request-options?group&action&client`（填过滤下拉，联动）。
**5 个指标卡**：① 服务器(serverId，副 name) ② `{days}天请求量`(totalRequests，副 `{totalSuccess} 次成功`) ③ `{days}天成功率`(successRate%) ④ 平均延迟(ms，按请求量加权) ⑤ Group 健康度(`onlineGroups/totalGroups`，副 `X 个禁用，Y 个无设备`)。
**3 张 Canvas 图**（X 轴=`statDate`）：每日请求量(柱，`totalRequests`) / 每日成功率(线，`successRate`) / 每日平均延迟(线，`avgLatencyMs`)。趋势每项字段：`statDate, totalRequests, successRequests, successRate, avgLatencyMs`。
**操作**：过滤表单 `#trendFilterForm`（group/action/client 输入 + days 数字 3–30 默认 7 + “刷新趋势”）→ 重拉 trends。

### 6.2 Group 管理 groups（轮询 5s）
**用途**：看 group 健康度/活跃度/在线覆盖，创建 / 启停 group。
**数据源**：`GET /api/groups` → `{items}`（一次全量，**过滤/排序/分页全在前端做**）。
**汇总卡**：全部 / 启用 / 在线 / 禁用 / 无设备 Group（对 items 前端统计）。
**表格列**：`Group | 启用 | 状态 | 设备数 | 在线数 | 7天请求 | 成功率 | 最后在线 | 最后请求 | 备注 | 操作`（来源 GroupInfo：`group,enabled,status,totalDevices,onlineDevices,requests7d,successRate,lastSeenAt,lastRequestAt,notes`）。状态∈`disabled/online/offline/stale/no_device`。
**操作**：
- 创建 Group `#createGroupForm`（name + enabled + notes）→ `POST /api/groups`
- 过滤/排序/分页 `#groupFilterForm`（前端，不发请求）：关键词 / status 下拉 / sort 下拉（最近请求 `recent_request_desc` / 7天请求 / 在线设备 / 设备总数 / 成功率 / 名称）/ pageSize 10·20·50
- 行内：“查看 Client”→ 跳 clients 页并预填该 group 过滤（无请求）；“启用/禁用”→ `PATCH /api/groups/{group}/status`

### 6.3 Group / Client 浏览 clients（轮询 5s）
**用途**：扁平表格浏览所有 client，点开看单 client 详情和最近活动。
**数据源**：`GET /api/devices?limit=200` → `{items}`（全量，前端过滤排序）。
**列表列**：`ClientId | Group | 平台 | 状态 | 最后在线 | IP | 创建时间 | 操作`（`clientId,group,platform,status,lastSeenAt,lastIp,createdAt`）。
**过滤**（前端）：按 group / 搜索 clientId·IP·平台 / client 状态（全部·online·offline）。
**详情弹窗** `#clientDetailModal`：信息网格（ClientId/Group/平台/状态/最后在线/IP/创建时间/更新时间）+ “最近结果摘要” + “最近请求”小表（列：开始时间·Action·状态·延迟·查看），后者来自 `GET /api/monitor/requests?group={group}&client={clientId}&page=1&pageSize=12`；点行“查看”→ 打开请求详情弹窗（同 6.4）。

### 6.4 请求记录 requests（不自动刷新）
**用途**：分页查历史 RPC 请求，点开看原始请求/返回 JSON。
**数据源**：`GET /api/monitor/requests?group&action&client&status&page&pageSize`（**服务端分页**，默认 pageSize 20）+ 过滤下拉来自 `GET /api/monitor/request-options`。
**表格列**：`开始时间 | 完成时间 | Group | Action | Client | 状态 | HTTP | 延迟 | 查看`（`createdAt,finishedAt,group,action,clientId,status,httpCode,latencyMs`）。
**操作**：过滤表单（group/action/client/status 4 下拉 + 应用）→ 重拉；分页（上一页/下一页 + `第 X/Y 页，共 N 条`）；“查看”→ `#requestDetailModal`：摘要网格 + “原始请求 JSON”（来自 `requestPayload`）+ “原始返回 JSON”（`responsePayload`）+ 各一个复制按钮。

### 6.5 设备监控 devices（轮询 15s）
**用途**：看设备周维度指标，点开看单设备 15 天日趋势。
**数据源**：`GET /api/metrics/clients/weekly?group&client` → `{items}`。
**汇总卡**：设备数 / 7天请求（副 successRequests）/ 成功率。
**周指标表**：`Client | Group | 总请求数 | 成功 | 失败 | 超时 | 平均延迟 | 操作`（`clientId,group,totalRequests,successRequests,failedRequests,timeoutRequests,avgLatencyMs`）。
**操作**：过滤（group/client + 应用）；行内“查看”→ `GET /api/metrics/clients/{clientId}/daily?days=15` → `#deviceTrendModal`：元信息 `15天请求 N，成功 M，成功率 X%` + 2 张 Canvas 折线（请求量 / 成功率）+ 日明细表（列：日期·Group·总请求数·成功·失败·超时·最大延迟，`statDate,group,totalRequests,successRequests,failedRequests,timeoutRequests,maxLatencyMs`）。趋势弹窗开着时随 15s 轮询同步刷新。

### 6.6 账户管理 users（不自动刷新）
**用途**：查看/创建/启停/改 RPC 权限/重置密码。
**数据源**：`GET /api/users` → `{items}`。
**表格列**：`用户名 | 角色 | 启用 | RPC | 最近登录 | 操作`（`username,role,enabled,canRpc,lastLoginAt`）。
**操作**：
- 创建账号 `#createUserForm`（username/password/role[client·admin]/enabled/canRpc/notes）→ `POST /api/users`
- 行内启用/禁用、允许/禁止 RPC → 都走 `PATCH /api/users/{id}/status`，body `{enabled, canRpc}`（**两字段一起传**）
- 重置密码 → `window.prompt` 输入 → `PATCH /api/users/{id}/password` body `{password}`

### 6.7 手动调用 invoke（不自动刷新）
**用途**：从控制台手动发起 RPC，选 group+action，指定 client 或自动路由，看原始响应。
**上下文数据**：`loadInvokeWorkspace()` 并发 `GET /api/groups`（填 group 下拉，只列启用的）+ `GET /api/devices?limit=200`（统计在线 client / 填 client 下拉）；选定 group 后 action 候选来自 `GET /api/monitor/request-options?group={group}`（填 `<datalist>` 历史 action）。
**表单** `#invokeForm`：Group(下拉，必选) · Action(input+datalist，默认 `ping`) · ClientId(下拉，空=自动路由) · 超时秒数(1–119，默认 20) · Payload JSON(textarea，默认 `{"msg":"hello from console"}`)。
**状态卡**：Group(已启用/已禁用/未选择) · 在线 Client 数 · Action · 路由(指定/自动)。
**操作**：“发起调用”→ `POST /rpc/invoke/{group}/{action}` body `{clientId, timeoutSeconds, payload}`（状态徽章 Ready→pending→结果状态/HTTP；`data.is_ok===false` 提示失败）；“格式化 JSON”美化 payload；“刷新上下文”重载选项。

---

## 7. 后台任务 & 生命周期

### 7.1 server 启动顺序
1. **加载配置** —— 仅从文件读，依次查 `deploy/linux/.env.docker` → `r0rpc.conf`，第一个命中就解析（`KEY=VALUE`，`#` 注释，去引号）。缺关键项直接 fatal。
2. **设置时区** —— 把 `time.Local` 设为 `TIME_ZONE`（默认 `Asia/Shanghai`）。
3. **建库建表**（20s 超时）—— 临时开无库名连接 `CREATE DATABASE IF NOT EXISTS`(utf8mb4) → 开带库名连接逐条建表 → `ensureIndexes` 补索引 → `seedGroupsFromExistingData`（从 devices/rpc_requests/两张 metrics 表 `INSERT IGNORE` 反推 groups）。
4. **开存储层** —— 打开 MySQL 连接池（设 MaxOpen/MaxIdle/ConnMaxLifetime，5s Ping）；**仅当 `REDIS_ADDR` 非空**才创建 Redis 客户端（读写超时 5s，空闲连接 2min）。**Redis 为空则整个系统无 Redis 也能跑**。
5. **构建 App** —— 建 `TokenManager`（用 JWT_SECRET）、内存 `rpc.Hub`（用修正后的 clientQueueSize / maxInFlight）、分配持久化 channel `persistCh`（缓冲=queueSize）。
6. **确保管理员** —— `EnsureBootstrapAdmin(BOOTSTRAP_ADMIN_USERNAME/PASSWORD)`。
7. **重建近期设备聚合**（20s 超时，失败只 log 不致命）—— 事务里删 `>= cutoff` 的 `device_daily_metrics`，再从 `rpc_requests`（排除 pending）按 `DATE(created_at),client_id,group_name` 重灌最近 `RAW_RETENTION_DAYS` 天。**用于进程重启后修正增量统计的丢失/重复**。
8. **起后台任务**（见 7.3）。
9. **监听** `HTTP_ADDR`（默认 `:8080`，ReadHeaderTimeout 5s）。

### 7.2 dbinit（一次性初始化工具）
`config.Load → ApplyTimeZone → BootstrapSchema(30s，建库/表/索引/seed groups) → store.New → EnsureBootstrapAdmin`，打印 “database and tables are ready” 后退出。**不起服务、不起后台任务、不监听端口**。部署时先跑它把 schema 和初始管理员准备好。

### 7.3 三类常驻 goroutine（随 ctx 取消退出）

**(a) 持久化 worker 池** —— 数量 `max(PERSIST_WORKERS, 32)`（默认 32）。
- 从 `persistCh` 取任务，**非阻塞 drain 攒到 256 条**（`persistBatchSize`，取不到就立刻发批）→ 批量写库；批失败则逐条回退，再失败只记日志。每条批任务超时 15s（`persistTaskTimeout`）。
- 处理 4 种任务（`persistTaskKind`）：
  - `create_request` → `CreateRPCRequest`（插入 pending 记录，逐条不合批）
  - `complete_request` → 合批 `CompleteRPCRequests`（写回状态/响应体/延迟/错误/finished_at）
  - `rpc_metric` → 按 `(stat_date,client_id,group_name,action_name)` 内存累加，合批 `IncrementRPCDailyMetricsBatch`
  - `device_metric` → 按 `(stat_date,client_id,group_name)` 累加，合批 `IncrementDeviceDailyMetricsBatch`
- 累加口径：`status=='success'`→success、`'timeout'`→timeout、其余→failed；同时累加 total、总延迟、max 延迟。
- **触发**：不是定时，是每次 RPC 完成时由 `InvokeRPC` 投递（1 条 complete + 1 条 rpc_metric + 有 client 时 1 条 device_metric；失败路径投递对应超时/拒绝记录）。

**(b) presence / 离线判定** —— 周期 `deviceOfflineGrace()/4`，夹在 **[5s, 60s]**（默认离线阈值 20s → 周期 5s）。每轮（10s 超时）：
- `MarkStaleDevicesOffline(now - grace)` → `UPDATE devices SET status='offline' WHERE status<>'offline' AND last_seen_at < ?`
- `cleanupPresenceCache` → 清理内存 `lastPresenceFlush` map（超过 `grace + presenceFlush*2` 的条目删除，防 map 无限增长）。
- 注意：**presence 落库刷新本身不在这**，而在 `TouchClientPresence`（poll/收到 WS 消息时）里按 `PresenceFlushSeconds` 节流写 `TouchDevice`，把高频心跳收敛成低频写库。

**(c) 数据保留 / 维护** —— 固定 **5min**（`defaultMaintenanceInterval`）。每轮（30s 超时）：
1. `CleanupOldRequests(RAW_RETENTION_DAYS)` → 删 `rpc_requests` 中 `created_at < NOW()-INTERVAL N DAY`（默认 3 天）。
2. `TrimAllRPCRequestScopes(RAW_REQUEST_KEEP_LATEST_PER_SCOPE)` → 按 `(group,action,client)` 每组只留最新 N 条（默认 100）。
3. `CleanupOldMetrics(AGGREGATE_RETENTION_DAYS)` → 删两张聚合表 `stat_date < 截止日` 的行（默认保留 30 天）。

> **没有独立的「心跳检查」goroutine**：心跳靠客户端流量更新 last_seen，由 (b) 依 last_seen 判离线。`HEARTBEAT_INTERVAL_SECONDS` 只是下发给客户端的建议心跳周期 + 服务端 WS ping 间隔，不驱动服务端定时器。**没有「按周聚合」任务**：只有按天聚合，周数据查询时实时算。

### 7.4 队列 / 背压
| 机制 | 默认 | 下限修正 | 作用 |
|---|---|---|---|
| 持久化队列 `persistCh` | 131072 | `max(cfg, 131072)` | 缓冲落库任务，削峰 |
| 持久化 worker | 32 | `max(cfg, 32)` | 并发批量写库 |
| 批大小 | 256（硬编码） | — | 每批上限 |
| 每 client 待发队列 | 2048 | `max(cfg, 2048)` | 满则 `Push` 返回 `ErrClientQueueFull` |
| 每 client 在途上限 | 256 | `max(cfg, 256)`；登录再夹到 [256,1024] | 单 client 同时在途 job 数 |

**持久化溢出策略**（`enqueuePersist`）：① 非阻塞塞 `persistCh` 成功即返回；② 满则起临时 goroutine 最多等 250ms；③ 仍塞不进就**当场同步写库**（不丢数据但拖慢）。
**派发侧背压**：`Hub.Invoke` 因无在线(`no_client`/502)、队列满/组饱和(`rejected`/429)、超时(`timeout`/504) 返回对应错误，并同样落一条记录+指标。

### 7.5 Redis 用途（可选，best-effort）
`REDIS_ADDR` 为空则客户端为 nil、所有 Redis 调用跳过。当前**只做在线状态镜像**（错误被忽略，不影响主流程）：
- `UpsertDevice`（登录）→ `SET presence:<clientID> = <groupName>`，TTL **2min**
- `TouchDevice`（心跳节流写库时）→ `EXPIRE presence:<clientID> 2min` 续期
- `MarkDeviceOffline` → `DEL presence:<clientID>`

**它不做**：跨节点派发/协调（Hub 全在进程内内存）、读缓存（查询都直连 MySQL）。**MySQL `devices.status` 才是权威在线状态**，Redis 只是带 TTL 的旁路镜像。

---

## 8. 配置项清单（`KEY=VALUE` 文本文件，**仅从文件读，不读环境变量**）

搜索路径：`deploy/linux/.env.docker` → `r0rpc.conf`（取第一个命中）。`#` 开头为注释，值两侧引号会被去掉。

### 8.1 连接类
| 键 | 默认 | 约束 |
|---|---|---|
| `HTTP_ADDR` | `:8080` | — |
| `MYSQL_HOST` | `mysql` | **必填**，空则报错 |
| `MYSQL_PORT` | `3306` | — |
| `MYSQL_USER` | `root` | **必填**，空则报错 |
| `MYSQL_PASSWORD` | `""` | — |
| `MYSQL_DB` | `r0rpc` | **必填**，空则报错 |
| `MYSQL_PARAMS` | `charset=utf8mb4&parseTime=true&loc=Asia%2FShanghai&timeout=5s&readTimeout=30s&writeTimeout=30s` | — |
| `REDIS_ADDR` | `""` | **空 = 整个禁用 Redis** |
| `REDIS_PASSWORD` | `""` | — |
| `REDIS_DB` | `0` | — |
| `TIME_ZONE` | `Asia/Shanghai` | 空则回退 Asia/Shanghai |
| `APP_NAME` | `r0rpc-demo` | 出现在 /healthz 的 name |
| `SERVER_ID` | `r0rpc-node-1` | 出现在 welcome/healthz 的 serverId |

### 8.2 性能类（都有下限兜底，配置值低于下限会被抬高）
| 键 | 默认 | 下限 |
|---|---|---|
| `MYSQL_MAX_OPEN_CONNS` | 256 | `<256 → 256` |
| `MYSQL_MAX_IDLE_CONNS` | 64 | `<64 → 64` |
| `MYSQL_CONN_MAX_LIFETIME_MINUTES` | 10 | `≤0 → 10` |
| `PERSIST_QUEUE_SIZE` | 131072 | `<131072 → 131072` |
| `PERSIST_WORKERS` | 32 | `<32 → 32` |
| `CLIENT_QUEUE_SIZE` | 2048 | `<2048 → 2048` |
| `CLIENT_MAX_IN_FLIGHT` | 256 | `<256 → 256`；登录时再夹到 [256,1024] |

### 8.3 业务调优类
| 键 | 默认 | 约束 / 派生 |
|---|---|---|
| `REQUEST_TIMEOUT_SECONDS` | 25 | 单次调用若带 `timeoutSeconds∈(0,120)` 则临时覆盖 |
| `RAW_RETENTION_DAYS` | 3 | `≤0 → 3`；原始请求保留天数 |
| `RAW_REQUEST_KEEP_LATEST_PER_SCOPE` | 100 | `≤0 → 100`；每 (group,action,client) 保留最新条数 |
| `AGGREGATE_RETENTION_DAYS` | 30 | `≤0 → 30`；日聚合保留天数 |
| `DEVICE_OFFLINE_SECONDS` | 0 | `≤0` 时：`DEVICE_OFFLINE_MINUTES>0` 取其 ×60，否则 **20** |
| `DEVICE_OFFLINE_MINUTES` | 0 | 最终被重算为 `DeviceOfflineSeconds/60` |
| `HEARTBEAT_INTERVAL_SECONDS` | 5 | `≤0 → 5`；若 `≥ 离线阈值` 则设为 `max(1, 离线/2)` |
| `PRESENCE_FLUSH_SECONDS` | 5 | `≤0 → min(5, 离线)`；若 `≥ 离线阈值` 则 `max(1, 离线/2)` |

> **派生约束要点**：心跳周期和 presence flush 都被强制 **< 离线阈值**（否则减半），保证判离线前至少刷新过一次。

### 8.4 鉴权类
| 键 | 默认 | 约束 |
|---|---|---|
| `JWT_SECRET` | `""` | **必填**，空则启动失败 |
| `BOOTSTRAP_ADMIN_USERNAME` | `admin` | — |
| `BOOTSTRAP_ADMIN_PASSWORD` | `""` | **必填**，空则启动失败 |

> Token 有效期硬编码在代码里（非配置）：admin 登录 JWT **12h**，client 登录 JWT **24h**。

---

## 9. 重写必读的「坑」与设计取舍

1. **单节点内存 Hub**：RPC 派发、客户端队列、在途计数、waiter 全在进程内内存。**Redis 当前只做 presence 镜像**（best-effort，可选），**不做跨节点协调、不做读缓存**。若目标是多节点，这块要自己补（如把 Hub 状态外置到 Redis/消息队列）。
2. **权威在线状态在 MySQL** `devices.status`；Redis presence 只是带 TTL 的旁路镜像。
3. **同一 clientId 单活跃连接**：新 WS 连上会挤掉旧连接（用递增 connID 区分，避免旧连接断开误清新会话）。
4. **WS 是手写 RFC6455**：不支持分片帧、单消息 4 MiB、client 帧必须掩码。用现成 WS 库重写时注意消息大小上限和掩码方向。
5. **结果压缩** `gzip+base64+json` 是客户端可选上报格式，服务端要能解。
6. **迟到/重复结果**：靠保留 10min 的 completed 表识别 `completed`/`expired`/`late`，避免超时后又来的结果污染。
7. **聚合口径**：failed = 非 success/timeout（把 error/no_client/rejected/pending 都算失败）；没有周聚合表，周数据实时算。
8. **配置只从文件读**（不读环境变量），搜索路径 `deploy/linux/.env.docker` → `r0rpc.conf`。
9. **前端无 SPA fallback**：只有 `/` 返回 index.html，其它未知路径 404 —— 若新前端用前端路由（history 模式），后端要加 fallback。
10. **`/rpc/clientQueue` 不需 admin 鉴权**（只校验分组存在且启用），是唯一的半公开调用面，重写时确认这是否是你要的。

---

*统计口径来自源码静态分析（`internal/{web,rpc,app,store,model,auth,config}` + `cmd/{server,dbinit}` + `ui/{index.html,app.js}`）。字段名/状态值/默认值以本文为准即可开始重写。*
