# Changelog

本项目重要改动记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/),语义化版本。

## [Unreleased]

### Android 与 JavaScript SDK
- 新增 JavaScript/TypeScript ESM SDK，提供设备 WebSocket、调用方 HTTP、自动/指定设备调用、
  在线状态查询、指数重连、Action 超时与 AppAudit V1 Recorder。
- 新增 Android/Kotlin SDK，以 `minSdk 21`、Java 8 字节码兼容 AAR 交付，使用 OkHttp、
  Coroutines 与 kotlinx.serialization，提供与 JavaScript SDK 对齐的设备端和调用方 API；
  设备默认以 Widevine MediaDrm ID 作为 `clientId`。
- 两端统一把未注册 Action、执行异常和超时映射为规范 result；鉴权失败停止重连，普通断线
  按 500 ms 起步、30 s 封顶指数退避。
- 新增两端安装说明、设备/调用方/AppAudit 示例与 SDD 规格；JavaScript **10 tests**、
  Android **8 tests** 通过，Android 测试通过 MockWebServer 使用真实 HTTP/WebSocket。

### Docker 性能测试与 4 核 4 GiB 预算
- 新增统一配置驱动的固定速率性能执行器，使用种子管理员登录、通过公开 API 创建临时令牌，
  并挂载 4 台真实 WebSocket 虚拟设备；结束后关闭连接并删除令牌。
- 10 个场景包含 7 个控制面读取、手动 RPC 自动路由 Hello、Access Token 自动轮询 Hello 和
  Access Token 随机指定设备 Hello；响应契约和全部设备覆盖均纳入强制阈值。
- 新增 Compose `performance` profile 和 JSON 结果卷；预热、持续时间、并发、目标速率、
  请求超时、错误率、P95 延迟与最小吞吐阈值均由 `config.yaml` 校验。
- 全部 9 个 Compose 服务声明 CPU、内存和 PID 硬限制；最坏情况 CPU 上限合计
  **4.00 核**，内存上限合计 **3840 MiB**，低于 **4 GiB**。
- 隔离受限全栈实测 **4 devices、1600 requests、0 failures、80.03 req/s、P95 7.50 ms、
  P99 10.31 ms**；3 个 Hello 场景各 160 次且 4 台设备全部收到任务。

### 前后端统一配置与完整 Docker Compose
- 新增根级统一 `config.yaml` 契约，API、Worker、Drizzle、迁移、种子和前端共同读取；
  `CONFIG_FILE` 只保留为文件位置选择器。
- CORS、浏览器 API 地址/端口、开发 Origin 和种子管理员迁入
  `app/frontend/bootstrap`；删除 `CORS_ORIGIN`、`ADMIN_*`、`NEXT_PUBLIC_*`、
  `NEXT_ALLOWED_DEV_ORIGINS`、`FRONTEND_CONFIG_FILE`、独立 `frontend.yaml` 和前端 env 模板。
- 新增根目录宿主机模板与 Compose 模板；前端只向浏览器注入
  `frontend.apiUrl/apiPort`，不泄露数据库、Redis、JWT 或管理员配置。
- 新增后端多阶段非 root 生产镜像；根目录 `compose.yaml` 完整编排 PostgreSQL、Redis、
  Manticore、migration、seed、API、Worker 和 frontend，并以健康检查/一次性任务完成状态
  控制启动顺序。
- 新增 4 项统一配置 loader 单元测试；当前 Jest **10 suites / 35 tests**、完整黑盒
  **172 passed**、前端 Playwright **12 passed**。前后端 lint/build、Compose config、
  两个应用镜像、容器内配置加载、迁移和种子均验证通过。

### 手动 RPC 操作按钮稳定性
- 手动 RPC 发起调用期间保留“发起调用”文案与按钮尺寸，只在原图标位置展示旋转进度；删除
  `animate-pulse` 闪烁。
- “刷新上下文”和“发起调用”在等待期间继续禁止重复操作，但保持原有不透明度与位置，避免
  相邻按钮因禁用态和文案长度变化共同闪动、位移。
- 浏览器回归测试会在延迟 RPC 响应期间校验两个按钮的禁用状态、不透明度和边界框保持稳定；
  前端 Playwright **12 passed**，lint 与生产构建通过。

### 系统日志表格长文本隔离
- 系统日志表格改为固定布局并为事件、操作者、动作/资源、目标、结果、时间和详情设置受控列宽；
  窄视口由表格容器横向滚动，不再由单条日志撑乱整行。
- 事件说明及其他可能变长的字段使用单行省略，并通过悬停标题保留完整内容，避免覆盖相邻列。
- 新增浏览器回归验证长事件说明的 overflow、ellipsis 和 nowrap 契约；前端 Playwright
  **12 passed**，lint 与生产构建通过。

### 后台授权公共 cache-aside
- 新增公共 `RedisCacheAsideService`：`getOrLoad` 统一 Redis 命中、zod 契约校验、
  PostgreSQL fallback 和回写，`writeAndInvalidate` 统一权威库写成功后的缓存删除。
- JWT 用户身份与权限快照默认缓存 60 秒，可配置范围为 60–300 秒；Redis 故障按缓存未命中
  fail-open，不阻断 PostgreSQL 鉴权或业务写入。
- 权限组挂载/移除权限、权限或权限组删除、用户分组/移组、账号启停和软删除会删除全部受影响
  用户缓存，现有 JWT 立即应用最新身份与权限。
- Access Token Guard、Device Token WS 鉴权及两类令牌写操作同步迁移到公共组件，删除重复的
  Redis 读取、回源、回写和失效代码。
- 新增 7 项公共组件单元测试和仅走 HTTP/WS 的授权缓存实时失效场景；Jest
  **9 suites / 31 tests**，完整黑盒 **172 passed, 0 failed**。
- `clientId` 多租户隔离与 `clientQueue?clientId=` project 边界硬化已明确移出项目范围，
  不再列为当前待办；现有单租户接口语义保持不变。

### 手动 RPC 调试
- 新增后台 JWT 保护的 `GET /rpc/debug/options` 与
  `POST /rpc/debug/invoke/:project/:action`；上下文返回功能组、历史 Action 和在线设备，调用
  复用现有真实 RPC 派发链路。
- 新增 `invoke/manual-rpc` 内置权限；19 条内置权限全部补齐面向管理员的说明，幂等种子会更新
  历史记录，operator 继续只获得 8 条 `read/*`。
- 手动调用请求日志记录后台 `requesterUserId`，系统操作审计只记录功能组、Action、设备和
  超时，不记录 Payload；公开 Access Token RPC 协议与鉴权边界保持不变。
- 新增 `/rpc-debugger` 页面、权限导航和预取，支持功能组/Action/在线设备/超时选择、Payload
  编辑与格式化、请求预览、响应、状态和耗时展示。
- 修复重复发起调试时先清空结果导致整块闪烁；等待新响应期间保留上一份实际请求与响应，完成后
  原位替换。
- OpenAPI 更新为 **39 个路径模板**；后端黑盒 **162 passed, 0 failed**，前端 Playwright
  **11 passed**，Jest **8 suites / 24 tests**、前后端 lint 与生产构建通过。

### 文档收口
- 同步根目录、后端、前端、部署、项目总览、能力矩阵、进度、待办、工程规范、交接提示与设计索引，统一当前 39 个 OpenAPI 路径、172 项后端黑盒、10 suites / 35 tests Jest 和 12 项前端 Playwright 基线。
- 补齐两类令牌作用域编辑、Device Token close 4002、复制回退、列表分页筛选、折线趋势图和宽版日志抽屉的行为说明。
- 明确历史计划、规格和归档只用于追溯；历史阶段数字和实施步骤不作为当前进度。

### 复制兼容性
- 新增公共 `CopyButton` 与剪贴板工具，令牌和 JSON 载荷统一复用复制状态与提示。
- 优先使用 Clipboard API；局域网 HTTP 等非安全上下文缺少 `navigator.clipboard` 或权限被拒绝时，自动回退到隐藏文本框复制，避免运行时异常。

### 令牌功能组二次编辑
- 新增 `PATCH /access-tokens/:id/projects` 与 `PATCH /device-tokens/:id/projects`，以事务替换两类令牌的完整功能组作用域，拒绝空选择和不存在的功能组。
- Access Token 更新后立即清除 Guard 正缓存，删除和新增的调用作用域随下一次请求生效。
- Device Token 更新后清除 WS 鉴权缓存，并通过 Redis pub/sub 通知所有 API 实例断开该令牌的旧作用域连接；设备重连后继承新功能组。
- 两类令牌管理页新增“编辑功能组”入口，共用可滚动多选组件并回显现有选择。

### 全列表筛选、分页与日志详情
- 功能组、设备、Device Token、Access Token、后台账号、权限组和权限目录补齐字段筛选与分页；请求日志、系统日志保留服务端分页并扩展可筛选字段。
- 全部列表默认每页 10 条、最大 100 条；分页器显示当前记录区间、数字页码、首尾省略号、每页条数和指定页跳转，并作为表格页脚连成一体。
- 表格统一改用正文无衬线字体、克制的表头字重、舒展行距、隔行底色和轻量悬停反馈；技术编号才保留等宽字体。
- 令牌明文、说明、payload 和设备扩展信息等长字段不进入筛选条件；令牌表增加固定列宽、截断和横向滚动，避免描述、令牌与功能组互相覆盖。
- 请求日志详情改为固定宽度右侧抽屉；全部 AppAudit Step 默认折叠，按需展开请求、响应和错误数据。
- 系统日志新增事件、目标类型和目标名称筛选；请求日志新增载荷索引和耗时范围筛选。

### 管理前端
- 新建 `frontend/`：Next.js 16、React 19、Tailwind CSS 4、shadcn 和 TanStack Query，默认端口 3001。
- 覆盖运行概览、功能组、设备、Access Token、Device Token、请求日志/AppAudit、后台账号、权限组和系统日志全部管理公开面。
- 运行概览的近 7 天请求量使用带节点、悬停数值和面积渐变的折线趋势图展示。
- 账号菜单支持本人改密；root 目标写入口和 RBAC 写入口按后端隔离规则显隐，后端 Guard 继续作为最终授权边界。
- 请求日志与系统日志使用服务端筛选分页，请求 payload 和设备 AppAudit Step 按 requestId 懒加载。
- 新增前端完整变量名门禁、ESLint、Next.js 生产构建和 Playwright 浏览器冒烟；边界守卫禁止 E2E 导入后端或直连 PG/Redis/Manticore。
- 新增前端生产 Dockerfile、运行时 `frontend.yaml` 和可覆盖基础设施端口；后端增加可由 `CORS_ORIGIN` 限定的 CORS。
- 修复系统审计拦截器读取无请求体 mutation 时抛错的问题，Access Token 与 Device Token 撤销接口恢复正常。
- 修复通过局域网 IP 打开开发前端时 HMR WebSocket 被 Next.js 来源检查拒绝的问题；自动加入本机 IPv4 地址，并支持 `NEXT_ALLOWED_DEV_ORIGINS` 补充自定义开发域名。
- 修复请求日志与系统日志翻页时短暂清空表格造成的闪屏；新页请求期间保留上一页数据，响应完成后原位替换。侧栏切换全部管理页面时先按权限预取公开接口，再提交路由切换，避免首次进入页面闪加载骨架。
- 系统日志扩展为完整控制面访问审计：记录登录成功/失败、全部 JWT 读取和 Guard/路由阶段拒绝；RPC/WS 数据面继续使用独立日志链路。
- 最终验证：前端 Playwright **11 passed**，前端 lint 与生产构建通过；后端 Jest **8 suites / 24 tests**、完整 HTTP/WebSocket 黑盒 **162 passed、0 failed**。

### 系统操作审计日志
- 盘点全部 14 张旧表：业务实体均具有语义名称与 `description`；关系表名称由复合外键表达，请求日志/聚合表按日志规则豁免，不机械增加无意义的 `name`。
- 新增第 15 张表 `system_logs` 和迁移 `0008`，包含操作 `name/description`、操作者快照、动作、对象、安全 metadata、HTTP 结果、IP、User-Agent 和时间。
- 新增全局 `SystemAuditInterceptor` 与显式 `@SystemAudit` 元数据，覆盖用户、project、两类 token 和 RBAC 全部业务 mutation；后续扩展为自动记录登录、控制面读取及 Guard/路由阶段拒绝。
- metadata 只采集安全 path/body/query 字段，不复制完整 body；密码和 token 明文不会写入系统日志，RPC/WS 数据面不重复写入。
- 新增 `GET /system-logs`，使用 `read/system-log`，支持操作者、action、subject、状态、时间和分页筛选；系统日志无修改/删除 API。
- project 创建接口补齐已有 `description` 列的输入能力和数据库长度校验。
- 种子权限现为 19 条且全部带完整说明，operator 的 `read/*` 权限为 8 条；当前验证为 Jest
  **8 suites / 24 tests**、OpenAPI **39 个路径模板**、完整黑盒 **162 passed、0 failed**。

### 权限组管理
- 复用现有 `roles`、`permissions`、`role_permissions`、`user_roles`，明确 Role 即权限组；用户可分配多个权限组，授权继续取所有有效组权限的并集，无数据库迁移。
- `GET /rbac/roles` 现返回嵌套权限；新增 `PATCH /rbac/roles/:id` 和 `GET /rbac/users/:userId/roles`。
- 新增请求体形式的权限挂载与用户分组接口，同时保留原 URL 形式 POST 兼容入口。
- 新增 `RootGuard` 并覆盖全部 RBAC 写接口；只有种子管理员可修改权限组、权限目录和用户分组，普通用户即使拥有 `manage/rbac` 仍返回 403。
- RBAC 读接口统一使用新增的 `read/rbac`；种子权限增至 17 条，operator 的 `read/*` 权限增至 7 条，部署只需重跑 `pnpm seed:admin`。
- 权限组权限采用固定批量查询组装，避免 N+1；新增 RootGuard 单元测试和纯 HTTP 黑盒权限组场景。
- 该阶段验证为 Jest **6 suites / 14 tests**、OpenAPI **34 个路径模板**、完整黑盒 **136 passed、0 failed**，E2E 仍只访问 HTTP/WebSocket。

### 管理员账号隔离与改密
- 新增 `PATCH /users/:id` 资料修改和 `PATCH /users/:id/password` 改密接口；创建、列表、详情和写响应统一显式选择安全用户字段，不返回 `passwordHash`。
- 新增共享 `AdministratorAccountPolicyService`：目标为 `isRoot` 管理员且请求者不是本人时返回 403；请求者编号只从 JWT 鉴权上下文读取。
- 统一保护资料、密码、enabled、软删除以及 RBAC 用户角色绑定/解绑，避免通过其他写入口绕过管理员隔离；`users.role` 继续只作遗留展示，不参与授权或保护。
- 密码、用户名和 description 输入补齐数据库对应的长度上限；密码修改后旧密码登录返回 401，新密码可登录。
- 新增策略单元测试和纯 HTTP 黑盒隔离场景；该阶段基线为 **131 passed、0 failed**，且继续由边界守卫禁止直连持久层。
- 新增 SDD 规格与实现计划，该阶段导出 32 个路径模板的 OpenAPI，并同步全部当前项目文档。

### 可读命名与控制流硬化
- 全量审计 `backend/src` 与 `backend/test`：清除单字母、双字母和 `cfg/ctx/req/res/dto/tx/svc` 等含糊变量名，测试与内部集成脚本同样纳入。
- 拆分 RPC 调度、WebSocket 上线、指标趋势、项目汇总、AccessToken Guard 和集成检查中的高复杂度流程，使用保护子句和单职责私有方法替代长分支。
- 新增 `test/assert-readable-source.js` 命名门禁；ESLint 强制圈复杂度 ≤ 10、嵌套深度 ≤ 3、单函数语句数 ≤ 40、花括号和无冗余 `else`。
- 新增 `pnpm lint:check`；`pnpm lint` 先执行命名门禁再自动修复 ESLint 问题。

### 设备上报 AppAudit 日志 Step
- 采用 AppAudit V1 结构化数据模型，WS `result` 新增可选 `appAudit`；设备一次性上报 metadata 和成功/失败 Step。
- 服务端使用 zod 校验 schemaVersion、ISO 时间、连续 sequence、字段长度、最多 64 metadata/128 Step 和 512 KiB 体积；非法审计整体丢弃但不影响 RPC 业务结果。
- `RequestLogJob`、Manticore `app_audit_json` 和 Monitor 详情完成冷路径；PostgreSQL 脊柱与日志列表不存/不返审计。已有 Manticore 表启动时自动补列。
- 黑盒新增真实 HTTP invoke → WS result+AppAudit → Worker → Monitor API 验证和非法审计隔离，该阶段基线为 121 passed、0 failed，仍不直连持久层。
- 新增当前设备接入协议 `docs/device-app-audit.md`、SDD 规格和实现计划，并同步全部当前项目文档。

### 完整性黑盒冒烟与文档统一
- `pnpm smoke` / `pnpm test:e2e` 统一为纯 HTTP/WebSocket 黑盒套件；新增 `test/assert-blackbox-e2e.js`，静态拒绝 E2E 导入 Drizzle、PG、Redis 或应用内部 service。
- 黑盒覆盖扩展到 117 项：全部 HTTP controller 方法，WS token 鉴权/heartbeat/ping/20 秒读超时/4 MiB/拒分片，RPC 成功失败超时、result 来源身份、重复去重，以及用 256 个并发 HTTP invoke 真实验证 maxInFlight、跳过饱和设备和 rejected。
- Worker 冷路径只通过 monitor/metrics API 观察；原 retention/stale/metrics/maxInFlight 直连脚本改名 `*.integration.ts` 和 `test:integration:*`，明确不属于 E2E。
- README、后端说明、部署说明、项目总览、能力矩阵、待办、继续开发提示、配置模板和 Agent 指南已同步当前 NestJS 实现；旧 Go/MySQL 文档移入 `docs/archive/`。

### 已完成 · 阶段1 设备组一等实体(6/6)
- 设备组升为一等实体(FK);新增 `client_groups` 关联表,一个设备可属于多个组;`clients`/`devices` 去掉松散的 `group_name` 字符串。
- 设备登录改为按 `client_groups` 授权:组成员关系以库表为准,不再采信客户端自报的组;设备账号「建号 + 建组关联」走单事务并对组名去重。
- WS presence 按 group_id 多组登记,`rpc/invoke/:group/:action` 按组名解析 group_id 调度;跨实例 session/waiter/去重(dedup)走 Redis,分布式路由闭环。
- 迁移回填脚本(旧 `group_name` → `groups` + `client_groups`)作为生产参考。
- 种子脚本(`seed-admin.ts`)追加建 demo 组 `cn-nodes`/`us-nodes` + 多组设备 `dev-001`(幂等);端到端 smoke(登录 → WS 上线 → 心跳 → 多组 invoke → 超时 → 无分组)全绿,阶段1 收尾。
- 顺带修了个阶段1 遗留 bug:`ClusterBus` 的 redis 订阅连接原本建在 `onModuleInit` 里,但依赖方 `ConnectionRegistry` 在 `WsModule` 的 providers 数组里排在它前面,Nest 按声明顺序调 `onModuleInit` 导致订阅先于连接建好触发,API 进程必炸;改成在构造函数里建连接(`RedisService.client` 构造时已就绪),去掉这个初始化顺序依赖。

### 已完成 · 阶段2 后台 CASL RBAC(6/6)
- RBAC schema:`roles` / `permissions`(action+subject 唯一)/ `role_permissions` / `user_roles`;`users` 加 `is_root` 列;`users.role` 字符串字段保留但已废弃/失效,鉴权不再读它。
- `RbacService`:查用户全部有效权限(`user_roles → role_permissions → permissions` 去重)、`isRoot` 查询、用 `@casl/ability` 的 `AbilityBuilder` 把权限元组编译成 `can(action, subject)` 的 ability;角色/权限 CRUD + 角色-权限/用户-角色绑定。
- 全局 `PermissionGuard`(`APP_GUARD`,排在 `JwtAuthGuard` 之后)fail-closed:未标 `@RequirePermission` 的接口直接拒绝(防漏标);`isRoot` 用户绕过权限判断直通;其余按 CASL ability 校验。`JwtStrategy.validate` 登录态里预加载 `permissions` + `isRoot` 挂到 `request.user`。
- 所有后台接口(users/groups/clients/rpc/monitor/metrics/rbac/auth.me)补齐方法级 `@RequirePermission(action, subject)`,移除失效的旧 `@Roles`。
- RBAC 管理 API `/rbac/*`(角色/权限 CRUD + 角色绑权限 + 用户绑角色),以及 `/auth/me` 返回当前用户的 `permissions` 声明。
- 种子脚本(`seed-admin.ts`)追加:admin 置 `is_root=true`;建 14 条权限全集(user/group/client 的 read-create-delete、metrics/monitor/rpc 的 read、invoke/rpc、manage/rbac、read/me);建 `operator` 角色,只挂 7 条 `read/*` 权限,幂等可重跑。端到端 smoke 新增 RBAC 断言:未登录 401、admin(isRoot)全绿、operator 只读通过、operator 越权(create/user)403、`/auth/me` 带 `permissions` 数组 —— 全部通过,阶段2 收尾。

### 已完成 · 阶段3 invoke access token
- invoke/clientQueue 与用户 JWT/RBAC 彻底解耦:`@Public` 跳过全局 JWT/Permission 守卫,改由独立的 `AccessTokenGuard` 校验 Bearer access token(有效性 + 未过期 + `active` 状态 + `:group` 作用域),redis 缓存热路径(fail-open,任何 redis 异常回落 DB 不阻断鉴权)。
- Access token 后台管理 API `/access-tokens`(生成返回明文/列表/撤销),挂 `manage/access-token` 权限(admin isRoot 直通,operator 等只读角色不获得);`request_logs` 记 `access_token_id`,追踪每次 invoke 由哪个 token 发起。
- 种子脚本(`seed-admin.ts`)权限全集补上 `manage/access-token`(共 14 条),幂等可重跑。
- 端到端 smoke 的 invoke 断言全部改用 access token(不再传管理员 JWT,传了也会 401):同一设备跨组场景下验证「token 作用域命中」(cn-nodes 内 invoke 成功)、「越组 403」(设备本身也在 us-nodes,但 token 未开该组作用域,校验的是 token 而非设备)、「无效 token 401」、「无 Authorization 头 401」、「撤销后 403」,以及原有的超时分支——全绿,阶段3 收尾。

### 已完成 · 阶段4 全局软删除 retrofit(5/5)
- 非日志实体表(users/groups/clients/devices/metrics/roles/permissions/access_tokens)统一加 `deleted_at`;唯一约束改 `WHERE deleted_at IS NULL` 的 **partial unique index**(软删同名后可重建);排除 `request_logs` 与 4 张 M2M 关联表(继续硬删关联行)。迁移 `0005`。
- 软删语义**在源头集中**在 `src/common/db/soft-delete.ts` 两个助手:`alive(table, ...conds)`(= `isNull(deletedAt) AND ...`)与 `softDelete(db, table, where)`(update deleted_at=now() + returning)。所有软删表读查询 `.where()` / join ON 一律经 `alive()`,删除一律经 `softDelete()`——禁止散写 `isNull`,可 grep 审计。(Drizzle 非 active-record,不做 TypeORM 式 per-entity Repository。)
- 安全缺口一并堵:软删用户/角色的 `user_roles`/`role_permissions` 不 cascade,`getUserPermissions` 的 join ON 用 `alive(roles)`+`alive(permissions)` 排除已删授权;`JwtStrategy` 改用 `findAuthUser`(`alive(users)`)拒绝已删用户的旧 JWT。
- access token 新增 `delete`(软删)操作 + `DELETE /access-tokens/:id` 端点,与 `revoke`(改 status)**正交**:删后同步删 redis 缓存立即失效,`findByToken` 经 `alive()` 返 null → guard **401**(区别 revoke 的 403)。
- 端到端 smoke 新增软删断言:token 软删后 invoke → 401(证 alive 过滤 + 缓存删)、role 软删后同名重建拿新 id(证 partial unique)——全绿(34 断言),阶段4 收尾。
- 顺带:**全项目 prettier + eslint 归零**(此前从没跑过,155 问题 → 0;请求对象/JSON.parse/socket 自定义属性补类型,`bootstrap()` 补 `void`,`ClusterBus` handler 放宽到 `void|Promise<void>`)。

### 已完成 · 阶段5 request_logs 自动保留/裁剪
- `request_logs`(日志表,硬删)加自动保留:`RequestLogsService.cleanupOldRequests(days)` 按天删超龄行 + `trimScopes(keep)` 用窗口函数按 `(group,action,client)` 每 scope 只留最新 N 条(`created_at DESC, id DESC`,`client_id` NULL 归同一 scope)。
- 复用现成的 5min 维护 worker:`WorkerBootstrap` 新增 `retention-sweep` 可重复任务,`MaintenanceProcessor` 按 `job.name` 分派(repair-stale-pending / retention-sweep 各自私有方法)。
- 阈值走集中 YAML 配置(zod 校验,fail-fast):`retention.rawRetentionDays`(默认 3)、`retention.keepLatestPerScope`(默认 100);非法值(≤0)直接启动失败,不静默兜底。
- retention 底层检查现为 `src/scripts/retention.integration.ts` / `test:integration:retention`，明确是直连 PG 的内部集成检查而非 E2E。
- 聚合表按天清理(`AGGREGATE_RETENTION_DAYS`)暂缓:`device_daily`/`rpc_daily` 表尚未建,随指标聚合体系一起做。

### 设计
- 三套授权域设计定稿:**后台 CASL RBAC** + **设备组一等实体(设备多组)** + **invoke 独立 access token**(按设备组作用域、可过期)。
- 全局软删除定稿:非日志实体表 `deleted_at` + partial unique + `alive()`/`softDelete()` 源头集中;`revoked`(运行状态)与 `deleted_at`(软删)正交。
  见 `docs/superpowers/specs/2026-07-08-group-scoped-rbac-invoke-tokens-design.md`,分 3 阶段落地。
