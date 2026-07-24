# 手动 RPC 调试设计

> 日期：2026-07-24  
> 状态：✅ 已实施并验证

## 1. 目标

在管理控制台提供低频手动 RPC 调试能力。管理员可以选择功能组、历史 Action、在线设备和超时，
编辑 JSON Payload，通过真实 RPC 派发链路验证设备行为，并查看原始请求、响应、业务状态和耗时。

## 2. 鉴权边界

- 新增独立权限 `invoke/manual-rpc`，说明为“在管理控制台手动发起 RPC 调试调用”。
- `/rpc/debug/*` 使用后台 JWT + `PermissionGuard`；root 仍按现有规则直通。
- operator 只拥有 8 条 `read/*` 权限，默认看不到入口，也不能调用调试接口。
- 公开 `/rpc/invoke/:project/:action` 与 `/rpc/clientQueue` 继续使用 `rk_` Access Token。
- 浏览器不读取、不选择、不缓存 Access Token；手动调试不能削弱三套凭证隔离。
- `invoke/rpc` 保留兼容说明，但不替代新的控制面权限。

内置权限共 19 条，每条都有完整 `description`。`seed-admin.ts` 在创建缺失权限后还会幂等更新
既有内置权限说明，部署无需数据库迁移，只需重跑 `pnpm seed:admin`。

## 3. 后端接口

### 调试上下文

```http
GET /rpc/debug/options?project=<optional>
Authorization: Bearer <user-jwt>
```

响应：

```json
{
  "projects": [
    {
      "id": 1,
      "name": "cn-nodes",
      "description": "中国节点",
      "enabled": true
    }
  ],
  "actions": ["ping", "collect"],
  "clientIds": ["device-001"]
}
```

未选择或找不到功能组时，仍返回功能组列表，`actions` 与 `clientIds` 为空。Action 从
`request_logs` 历史记录去重读取；设备列表来自 Redis 实时在线状态。

### 发起调用

```http
POST /rpc/debug/invoke/:project/:action?clientId=<optional>
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "timeoutSeconds": 20,
  "payload": {}
}
```

请求体复用 `InvokeDto`：超时必须是大于 0 的整数，Payload 必须是 JSON 对象。未指定
`clientId` 时由服务端在功能组内轮询；指定时只调用该设备。接口调用 `RpcService.invoke`，
因此 project enabled、在线态、maxInFlight、跨实例派发、结果身份匹配、超时和状态语义与公开
RPC 完全一致。

## 4. 日志与审计

- 手动调用继续进入 BullMQ 请求日志冷路径，PG 脊柱写入 JWT 用户的 `requesterUserId`。
- 公开 Access Token 调用继续写 `accessTokenId`，两种发起身份不会混用。
- 读取调试上下文记录 `read/manual-rpc` 系统操作审计。
- 发起调用记录 `invoke/manual-rpc` 系统操作审计，白名单只包含功能组、Action、可选设备和
  超时。
- Payload 只进入 RPC 请求日志/Manticore，不进入 `system_logs`；系统审计也不保存任何 token。

## 5. 前端

路由 `/rpc-debugger`：

- 侧栏入口和页面边界都检查 `invoke/manual-rpc`。
- TanStack Query 先加载功能组，再按所选功能组加载历史 Action 与在线设备。
- Action 支持历史建议或直接输入；目标设备留空表示自动路由。
- Payload 编辑器要求 JSON 对象并支持格式化；超时只接受正整数。
- 调用前展示请求预览，调用后展示实际请求、原始响应、HTTP 状态、业务状态、设备和耗时。
- 重复发起调用时保留上一份实际请求和响应，不卸载结果区；等待状态只更新说明、`aria-busy`
  和原图标位的旋转进度，操作按钮保持文案、尺寸、位置与不透明度，新响应到达后原位替换。
- JSON 复制统一复用 `JsonBlock` → `CopyButton`，兼容非安全上下文。
- 侧栏导航先预取公开调试上下文接口，再切换页面，保持现有无闪屏规则。

## 6. 验收结果

- 缺少 JWT 返回 401；缺少 `invoke/manual-rpc` 的普通账号返回 403。
- root 管理员能读取功能组、历史 Action 和在线设备，并通过真实 WebSocket 设备完成调用。
- 请求日志可从公开 Monitor API 看到正确 `requesterUserId`。
- 系统日志可查到手动调用，且不包含 Payload 标记。
- 19 条内置权限说明全部非空，手动 RPC 权限说明准确。
- OpenAPI **39 个路径模板**。
- 后端 Jest **8 suites / 24 tests passed**。
- HTTP/WebSocket 黑盒 **162 passed, 0 failed**。
- 前端 lint、Next.js 生产构建通过；Playwright **11 passed**。
- 后端和前端 E2E 都只使用 HTTP/WebSocket 或浏览器公开接口，不连接持久层。
