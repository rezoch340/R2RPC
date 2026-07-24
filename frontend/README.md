# RER0RPC Frontend

RER0RPC 管理控制台，技术栈为 Next.js 16 App Router、React 19、Tailwind CSS 4、
shadcn/base-nova 和 TanStack Query。

## 页面

- 运行概览：累计请求、在线设备、功能组、延迟和近 7 天趋势
- 功能组：创建、启停、删除和派生运行态
- 设备：在线态、平台、IP、并发上限和扩展信息
- Access Token / Device Token：创建、复制、撤销、删除和功能组授权
- 请求日志：HTTP 分页筛选、Manticore payload 懒加载和 AppAudit Step
- 后台账号：资料、改密、启停、删除和权限组分配
- 权限组：组内权限、权限目录和 root-only 写隔离
- 系统日志：登录、控制面读取、拒绝访问、业务写入、操作者、结果和安全 metadata

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

`pnpm lint` 会先执行命名门禁：组件、页面、E2E 和工具代码都禁止单/双字母变量及
`cfg/ctx/req/res/dto/tx/svc` 等含糊缩写。

## 工程约定

- 页面只调用公开 API，不读取后端数据库。
- 服务端分页用于请求日志和系统日志；小型实体列表在浏览器内过滤。
- Mutation 成功后通过 TanStack Query 精确失效对应 query key。
- RBAC 只用于前端显隐；后端 Guard 始终是最终授权边界。
- `isRoot` 目标的修改入口只对本人开放；RBAC 写入口只对 root 展示。
- 请求详情按 requestId 懒加载 payload 和 AppAudit，列表不携带大字段。
- 变量名写完整语义，优先保护子句，不堆叠长 `if/else`。
