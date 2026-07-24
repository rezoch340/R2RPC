# RER0RPC Frontend

RER0RPC 管理控制台，技术栈为 Next.js 16 App Router、React 19、Tailwind CSS 4、
shadcn/base-nova 和 TanStack Query。

## 页面

- 运行概览：累计请求、在线设备、功能组、延迟和近 7 天折线趋势
- 功能组：创建、启停、删除、派生运行态、字段筛选和分页
- 设备：在线态、平台、IP、并发上限、扩展信息、字段筛选和分页
- Access Token / Device Token：创建、复制、二次编辑功能组、撤销、删除、字段筛选和分页
- 请求日志：HTTP 服务端筛选分页、Manticore payload 懒加载和 AppAudit Step
- 手动 RPC 调试：选择功能组、历史 Action、在线设备和超时，编辑/格式化 Payload，并展示
  原始请求、响应、状态与耗时
- 后台账号：资料、改密、启停、删除、权限组分配、字段筛选和分页
- 权限组：组内权限、权限目录、两张表独立筛选分页和 root-only 写隔离
- 系统日志：登录、控制面读取、拒绝访问、业务写入、多字段服务端筛选分页和安全 metadata

令牌明文和 JSON 载荷统一使用公共复制按钮；Clipboard API 在非安全上下文不可用时会自动
回退到兼容复制，不要求通过 HTTPS 或 localhost 打开控制台。

## 本地运行

```bash
pnpm install
pnpm dev
```

前端监听 `http://127.0.0.1:3001`。默认连接浏览器当前主机的 `3000` 端口；后端位于其他地址时：

```bash
cp .env.local.example .env.local
# 编辑 NEXT_PUBLIC_API_URL
pnpm dev
```

后端必须允许前端 Origin。RER0RPC API 默认开启 CORS；生产可用后端环境变量
`CORS_ORIGIN=https://console.example.com` 限制允许来源，多个来源用逗号分隔。

开发服务器会自动把本机 IPv4 网卡地址加入 Next.js `allowedDevOrigins`，因此通过局域网 IP
访问时 HMR WebSocket 仍可正常连接。反向代理或自定义开发域名可在 `.env.local` 增加：

```bash
NEXT_ALLOWED_DEV_ORIGINS=console.local,dev.example.test
```

## 运行时配置

容器可挂载 `/app/frontend.yaml`，无需重建镜像即可切换 API：

```yaml
apiUrl: https://api.example.com
# apiUrl 留空时按当前主机回连：
apiPort: 3000
```

解析优先级：

1. `/app/frontend.yaml` 注入的 `apiUrl`
2. `NEXT_PUBLIC_API_URL`
3. 当前页面协议与主机 + `apiPort` / `NEXT_PUBLIC_API_PORT`
4. 服务端渲染兜底 `http://127.0.0.1:3000`

## 验证

```bash
pnpm lint
pnpm build
E2E_API_URL=http://127.0.0.1:3000 pnpm test:e2e
```

前端 E2E 使用浏览器登录并访问公开 HTTP API。`test/assert-blackbox-e2e.cjs`
会拒绝测试导入后端内部模块、数据库或 Redis 客户端；测试不直接连接任何持久层。
当前 Playwright 基线为 **11 passed**，覆盖全部管理页、手动 RPC 调试、字段筛选分页、两类
令牌功能组二次编辑、非安全上下文复制回退、请求详情抽屉、账号改密入口、移动导航、导航
预取和登录保护。

`pnpm lint` 会先执行命名门禁：组件、页面、E2E 和工具代码都禁止单/双字母变量及
`cfg/ctx/req/res/dto/tx/svc` 等含糊缩写。

## 工程约定

- 页面只调用公开 API，不读取后端数据库。
- 请求日志和系统日志使用服务端筛选分页；其他实体表一次加载后在浏览器内执行字段筛选和分页。
- 全部分页默认 10 条/页、最大 100 条/页；页脚提供记录区间、数字页码、每页条数和指定页跳转。
- 表格正文使用无衬线字体，只有设备编号、令牌、动作等技术字段使用等宽字体。
- 长载荷、说明、令牌明文和高变化扩展字段不进入筛选条件。
- 分页请求期间保留上一页数据；侧栏导航预取目标页公开接口后再切换，避免页面闪加载骨架。
- 手动 RPC 重复调用期间保留上一份实际请求和响应，新结果完成后原位替换，不清空结果区。
- Mutation 成功后通过 TanStack Query 精确失效对应 query key。
- RBAC 只用于前端显隐；后端 Guard 始终是最终授权边界。
- 手动 RPC 页面和导航使用 `invoke/manual-rpc` 显隐，并只调用后台 JWT 保护的
  `/rpc/debug/*`；不得让浏览器读取或代填 Access Token。
- `isRoot` 目标的修改入口只对本人开放；RBAC 写入口只对 root 展示。
- 请求详情从右侧抽屉打开，按 requestId 懒加载 payload 和 AppAudit；每个 AppAudit Step 默认收起，列表不携带大字段。
- 复制交互统一使用 `CopyButton`；页面不得直接调用 `navigator.clipboard.writeText`。
- 变量名写完整语义，优先保护子句，不堆叠长 `if/else`。
