# R2RPC 发布流程

R2RPC 当前处于 `0.x` 阶段，服务端、管理前端、JavaScript SDK 和 Android SDK 采用独立版本。
在权利人明确批准公开授权和制品分发前，仓库及 SDK 均保持 `UNLICENSED`，不得发布到 npm
公共 Registry、Maven Central 或其他公开制品仓库。

## 版本与标签

| 制品 | 版本来源 | 标签格式 |
|---|---|---|
| 服务端与管理前端 | 发布提交与 `CHANGELOG.md` | `vMAJOR.MINOR.PATCH` |
| JavaScript SDK | `sdk/javascript/package.json` | `javascript-vMAJOR.MINOR.PATCH` |
| Android SDK | `sdk/android/r2rpc-sdk/build.gradle.kts` | `android-vMAJOR.MINOR.PATCH` |

`0.x` 期间也必须记录不兼容变更。稳定版发布后遵循语义化版本：破坏兼容为 major、新增兼容
能力为 minor、兼容修复为 patch。

## 发布前检查

1. 确认工作区干净，目标提交已合并到 `main`。
2. 将 `CHANGELOG.md` 的 `[Unreleased]` 内容整理到带日期的版本标题。
3. 同步 SDK 版本、README 安装示例、OpenAPI `info.version` 和兼容性说明。
4. 确认没有 `.env`、`config.yaml`、Token、密码、内部地址、IDE 文件或构建产物进入制品。
   生产配置必须设置 `app.openApiEnabled: false`，但静态 `docs/openapi.yaml` 仍需随版本发布。
   Cloudflare → Nginx/OpenResty 部署还必须设置 `app.trustedProxyHops: 1`、精确 CORS、
   `wss://` 公网地址和独立 `frontend.apiUrl`。
5. 执行：

```bash
./scripts/local-ci.sh --full
(cd backend && CONFIG_FILE=../deploy/config.yaml pnpm config:check:production)
(cd sdk/javascript && corepack pnpm check && npm pack --dry-run)
(cd sdk/android && ./gradlew :r2rpc-sdk:testDebugUnitTest :r2rpc-sdk:assembleRelease)
docker compose build api frontend
```

6. 发布服务端镜像时还应执行 Compose 性能测试。
7. 对生成的 `docs/openapi.yaml` 执行差异审查，确保每个操作都有说明、成功响应 schema、
   鉴权方案和 4xx 响应。
8. 在正式域名执行：

```bash
deploy/reverse-proxy/check-production.sh \
  https://console.example.com \
  https://rpc.example.com
```

确认 Cloudflare 为 Full (strict)、WebSockets 已启用、API 缓存已绕过、源站 80/443 仅允许
Cloudflare IP 段，随后使用真实 Device Token 完成自动路由与指定设备 Hello。

Pull Request 与 `main` 推送不运行 GitHub Actions。后端、前端、SDK 和完整黑盒均在本地
验收，结果记录到 Pull Request；GitHub Actions 只在合法 `v*` 标签上构建并发布后端/前端
镜像。

## 发布与回滚

- 创建签名 `v*` 标签会触发 `.github/workflows/publish-ghcr.yml`，自动构建并发布
  `ghcr.io/rezoch340/r2rpc-backend` 和 `ghcr.io/rezoch340/r2rpc-frontend` 的版本标签与
  `latest`；GitHub Release 应附 Changelog、镜像摘要、兼容性和迁移说明。
- SDK 先在本地或私有 Registry 验证安装，再按批准的目标 Registry 发布。
- 数据库变更必须提供向前修复方案；不得假设可以安全回滚已经被新版本写入的数据。
- 回滚应用前确认旧版本仍能读取当前 schema、Redis 键和 WebSocket 消息。
- 发布后重新运行健康检查、登录、设备上线、自动/指定设备 RPC 和日志查询。

发布失败时应立即停止后续制品，记录已发布的版本或摘要，撤回可撤回制品，并在
`CHANGELOG.md` 与 Release 中说明替代版本。
