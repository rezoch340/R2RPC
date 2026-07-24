# RER0RPC 管理前端设计

> 日期：2026-07-24
> 状态：已实现

## 1. 目标

在不改变 RER0RPC 后端领域模型的前提下，使用 Next.js App Router、shadcn、TanStack Query 和数据驱动公共组件结构，提供完整管理控制台。

## 2. 硬边界

1. 前端只能访问公开 HTTP API，不导入 Nest 模块，不连接 PostgreSQL、Redis 或 Manticore。
2. RBAC 前端显隐只改善体验，后端 Guard 是唯一授权边界。
3. `isRoot` 账号的资料、密码、启停、删除和权限组关系只对本人展示可写入口。
4. 权限组、权限目录和用户分组写入口只对 `isRoot=true` 展示。
5. 请求日志列表只读 PG 脊柱；payload 与 AppAudit 在打开详情后按 requestId 懒加载。
6. 页面、组件、E2E 和工具脚本都执行完整变量名门禁。

## 3. 技术方案

- Next.js 16 App Router、React 19、TypeScript strict。
- Tailwind CSS 4 + shadcn base-nova 组件源码。
- TanStack Query 管理服务端状态和 mutation 后精确失效。
- 服务端分页切换时保留上一页数据；侧栏导航按当前权限预取目标页面的公开接口，接口完成后再提交路由，避免短暂骨架屏闪烁。
- 所有实体表都有字段筛选和分页；长载荷、说明、令牌明文及高变化扩展字段不作为筛选项。
- 所有分页默认 10 条/页、最大 100 条/页；分页器作为表格页脚，展示记录区间、数字页码、每页条数和指定页跳转。
- 表格统一使用无衬线正文、轻量表头、舒展行距、隔行底色和悬停反馈，技术标识符单独使用等宽字体。
- 请求详情使用右侧抽屉，AppAudit Step 默认折叠，展开后才占用详情阅读空间。
- JWT 存储在浏览器 `localStorage`；401 时清理并回到登录页。
- API 地址支持容器运行时 YAML、构建期环境变量和当前主机端口回连。
- 后端启用 CORS；生产使用 `CORS_ORIGIN` 限定允许来源。

## 4. 页面映射

| 页面 | 能力 |
|---|---|
| 运行概览 | overview、近 7 天折线趋势、功能组和设备在线汇总 |
| 功能组 | 创建、启停、删除、设备数、7 天成功率、字段筛选和分页 |
| 设备 | 在线态、平台、IP、并发上限、扩展信息、字段筛选和分页 |
| 两类令牌 | 功能组创建与二次编辑、明文复制、撤销、软删除、字段筛选和分页 |
| 请求日志 | 服务端筛选分页、右侧详情抽屉、payload、默认折叠 AppAudit Step |
| 后台账号 | 创建、资料、改密、启停、删除、权限组分配、字段筛选和分页 |
| 权限组 | 组 CRUD、权限矩阵、权限目录 CRUD、两张表独立筛选分页 |
| 系统日志 | 操作者、动作、资源、目标、结果、时间和服务端筛选分页 |

## 5. 组件边界

复用 `PageHeader`、`DataTable`、`FilterBar`、`PermissionBoundary`、`FormDialog`、
`ConfirmDialog`、`Pagination`、`RowActions`、`JsonBlock`。
两类令牌共用同一个领域组件；功能组权限矩阵、用户分组和 AppAudit Step 保持专用组件，
不抽象为充满条件分支的通用 CRUD 配置层。

## 6. 测试

- `pnpm lint`：完整变量名门禁 + ESLint。
- `pnpm build`：Next.js 生产构建和 TypeScript。
- Playwright：从登录 UI 获取真实 JWT，逐页验证公开 HTTP API。
- Playwright 延迟真实用户列表接口，验证预取期间保留当前页面且目标页不出现加载骨架。
- `test/assert-blackbox-e2e.cjs`：静态拒绝后端内部导入、持久层客户端和 SQL。
- 后端 155 项 HTTP/WebSocket 黑盒继续复跑，确认 CORS、访问审计与令牌作用域更新不影响设备 WS 和 Worker 冷路径。

验证结果：前端变量名门禁与 ESLint 通过、Next.js 生产构建通过、Playwright
**9 passed**；后端 Jest **8 suites / 24 tests passed**，HTTP/WebSocket 黑盒
**155 passed, 0 failed**。
