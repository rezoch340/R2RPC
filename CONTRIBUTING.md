# 参与 R2RPC 开发

感谢参与 R2RPC。提交代码前请先阅读
[`CLAUDE.md`](CLAUDE.md)、[`docs/design-conventions.md`](docs/design-conventions.md)
和[`SECURITY.md`](SECURITY.md)。

## 开发环境

需要 Node.js 24、pnpm 11、Docker Compose，以及 Android SDK 36（仅 Android SDK 变更需要）。

```bash
cp config.example.yaml config.yaml
cp deploy/config.example.yaml deploy/config.yaml
(cd backend && corepack pnpm install)
(cd frontend && corepack pnpm install)
(cd sdk/javascript && corepack pnpm install)
docker compose up -d postgres redis manticore
```

运行 API、Worker 和前端：

```bash
(cd backend && pnpm dev:api)
(cd backend && pnpm dev:worker)
(cd frontend && pnpm dev)
```

## 变更要求

- 分支应短生命周期、单一目的，提交信息说明行为变化而不是文件列表。
- 禁止单/双字母变量和团队已禁止的含糊缩写；优先早返回，避免大段 `if/else`。
- 后台列表默认 10 条/页、最大 100 条/页；适合稳定筛选的字段必须支持筛选。
- E2E、冒烟和性能测试只能通过公开 HTTP、WebSocket 或浏览器 UI 验证，禁止直连数据库、
  Redis、Manticore 或应用内部 Service。
- API、配置、协议、权限、用户可见行为或测试基线变化时，必须在同一 Pull Request 更新文档。
- 新增接口必须提供 OpenAPI 描述、成功响应 schema、鉴权方案和实际可能出现的 4xx 响应。
- 不提交 `config.yaml`、`.env`、Token、密码、生产日志、IDE 状态或构建产物。

## 提交前验证

日常提交前统一执行本地质量门禁：

```bash
./scripts/local-ci.sh
```

发布前或影响 HTTP、WebSocket、Compose、配置、权限和跨端协议时执行完整黑盒：

```bash
./scripts/local-ci.sh --full
```

SDK 不进入服务端/前端门禁，修改对应 SDK 时按范围额外执行：

```bash
(cd sdk/javascript && corepack pnpm check)
(cd sdk/android && ./gradlew :r2rpc-sdk:testDebugUnitTest :r2rpc-sdk:assembleRelease)
```

`--full` 会使用独立 Compose 项目启动真实 API、Worker 和基础设施，只通过公开 HTTP、
WebSocket 与浏览器 UI 验证；测试固定挂载 `deploy/config.example.yaml`，并在结束时清理
测试容器和卷。执行前需确保默认服务端口未被占用。Pull Request 与 `main` 推送不会启动
云端质量门禁；提交者必须在 Pull Request 中记录本地执行命令和结果。GitHub Actions 只负责
`v*` 标签对应的后端/前端镜像发布。

## Pull Request

Pull Request 应包含：

1. 变更目的和明确的非目标。
2. API、权限、数据库、配置、SDK 和兼容性影响。
3. 已执行的命令及结果；未执行项必须说明原因。
4. UI 变化截图，或协议/接口变化示例。
5. 文档、OpenAPI、迁移与回滚说明。

安全漏洞不要提交公开 Pull Request，请按[`SECURITY.md`](SECURITY.md)私密报告。

## 许可证

当前仓库没有开放源代码许可，参见[`LICENSE`](LICENSE)。提交贡献即表示你有权提交相关内容，
但不会自动改变仓库或上游代码的许可状态。任何对外授权或公开制品发布必须由权利人明确批准。
