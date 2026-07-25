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

按变更范围执行；影响共享协议时应执行全部项目：

```bash
(cd backend && pnpm lint:check && pnpm build && pnpm test && pnpm openapi:gen)
(cd frontend && pnpm lint && pnpm build && pnpm test:e2e)
(cd sdk/javascript && corepack pnpm check)
(cd sdk/android && ./gradlew :r2rpc-sdk:testDebugUnitTest :r2rpc-sdk:assembleRelease)
docker compose config --quiet
```

后端完整性冒烟需要隔离基础设施、真实 API 和 Worker：

```bash
(cd backend && pnpm smoke)
```

Pull Request 与 `main` 推送会由 `.github/workflows/ci.yml` 自动复跑后端、前端门禁和完整
Compose 黑盒。自动流程只构建后端与前端；SDK 变更仍由提交者按影响范围在本地执行对应检查并
把结果写入 Pull Request。

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
