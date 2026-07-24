# 安全策略

## 支持范围

R2RPC 尚未发布稳定版本。安全修复以 `main` 当前代码为准，不为历史提交、个人分支、未合并
Pull Request 或修改后的第三方镜像提供回溯支持。

## 私密报告漏洞

请优先使用仓库的
[GitHub Private Vulnerability Reporting](https://github.com/rezoch340/R2RPC/security/advisories/new)
提交报告，不要在公开 Issue、Discussion、日志截图或 Pull Request 中披露可直接利用的细节。
如果该入口暂不可用，请通过
[仓库所有者的 GitHub 联系方式](https://github.com/rezoch340)
请求建立私密沟通渠道。

报告应至少包含：

1. 受影响的提交、版本、接口或组件。
2. 可重复的最小验证步骤和必要配置。
3. 影响范围，包括鉴权、功能组、`clientId`、Token 或数据边界。
4. 已知缓解方式；如有补丁，可附最小差异，但不要包含真实凭证或生产数据。

维护者确认后会在私密渠道同步复现状态、修复计划和披露时间。修复合并前不得公开利用细节。

## 安全基线

- 生产环境必须替换 `config.yaml` 中的 JWT 密钥、引导管理员密码和数据库密码。
- 管理端 HTTP 与设备 WebSocket 应部署在 TLS/WSS 后，并限制 CORS 与网络入口。
- `rk_` Access Token、`dk_` Device Token、后台 JWT 和请求载荷不得写入 Issue、CI 日志或截图。
- E2E、性能测试和问题复现必须走公开 HTTP/WebSocket 接口，不得将生产数据库复制到测试环境。
- 安全边界变更必须同时更新测试、OpenAPI、`CHANGELOG.md` 和相关协议文档。
