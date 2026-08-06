# 使用 1Panel 部署 R2RPC

已有生产环境从旧标签升级到新标签时，使用独立的
[`UPDATE.md`](UPDATE.md)，不要重复执行首次安装步骤或覆盖真实生产配置。

本文档描述已验证的生产链路：

```text
Cloudflare
  ├─ console.your-domain.com ─ HTTPS ─┐
  └─ rpc.your-domain.com ─ HTTPS/WSS ─┤
                                      ▼
                           1Panel OpenResty
                              ├─ 127.0.0.1:3001 Frontend
                              └─ 127.0.0.1:3000 API / WebSocket
                                      ▼
                     Docker Compose / Worker / 基础设施
```

2026-07-25 的实机验收环境为 Ubuntu 22.04、1Panel v2.0.15、1Panel OpenResty
1.31.1.1、Docker 27 与 Docker Compose 2.28。文中统一使用通用域名，避免把实机地址
复制到其他部署。

## 1. 前置条件

- Linux x86-64 服务器，建议至少 4 CPU、4 GiB 可用内存和 20 GiB 可用磁盘。
- 已安装 Docker、Docker Compose、1Panel 和 1Panel 应用商店中的 OpenResty。
- Cloudflare 中准备两个指向同一源站的 Proxied DNS 记录。
- 服务器安全组允许 Cloudflare 访问 80/443，运维来源允许访问 SSH 和 1Panel。
- 已推送的 GHCR Release 镜像；本文示例使用 `v0.1.6`。

默认 Compose 声明的服务 CPU 上限合计为 4.00 核，内存上限合计为 3840 MiB。该限制不包含
Docker daemon、BuildKit、1Panel 和宿主机 OpenResty。资源充足且希望容器使用宿主机全部可用
CPU 和内存时，可以在下文改用无限资源生成脚本。

## 2. 安装发布文件

1Panel 的“终端”通常已经是 root shell。提示符以 `root@` 开头时不要再次执行 `sudo -i`，否则
会启动嵌套登录 shell 并把当前目录重置为 `/root`。只有当前用户不是 root 时，才先单独执行：

```bash
sudo -i
```

等待出现 root 提示符后，再执行下面的安装命令：

```bash
git clone --branch v0.1.6 --depth 1 \
  https://github.com/rezoch340/R2RPC.git \
  /opt/r2rpc
cd /opt/r2rpc
```

生成真实生产配置和生产 Compose 覆盖文件：

```bash
cp deploy/config.production.example.yaml deploy/config.yaml
cp deploy/compose.production.example.yaml deploy/compose.production.yaml
```

在 `deploy/config.yaml` 中至少修改：

```yaml
app:
  port: 3000
  globalPrefix: ''
  publicWsUrl: wss://rpc.your-domain.com/api/client/ws
  openApiEnabled: false
  trustedProxyHops: 1
  corsOrigins:
    - https://console.your-domain.com

frontend:
  apiUrl: https://rpc.your-domain.com
  apiPort: 443
  allowedDevOrigins: []

db:
  host: postgres
  port: 5432
  user: r2rpc
  password: REPLACE_WITH_RANDOM_DATABASE_PASSWORD
  database: r2rpc

jwt:
  secret: REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
  expiresIn: 7d
  authorizationCacheTtlSeconds: 60

bootstrap:
  admin:
    username: admin
    password: REPLACE_WITH_A_LONG_RANDOM_ADMIN_PASSWORD
```

可使用以下命令生成随机值：

```bash
openssl rand -hex 24 # PostgreSQL 密码
openssl rand -hex 48 # JWT Secret
openssl rand -base64 24 # 初始管理员密码
```

将同一个 PostgreSQL 密码同步写入 `deploy/compose.production.yaml`：

```yaml
services:
  postgres:
    environment:
      POSTGRES_PASSWORD: 与-deploy-config-yaml-db-password-完全一致
```

这是 PostgreSQL 官方镜像首次初始化数据库使用的密码；它必须与应用统一配置中的
`db.password` 一致。其他容器内部地址继续使用 `postgres`、`redis`、`manticore` 和 `api`，
不得替换成公网域名。

配置包含密钥且需要被非 root 的 Node 容器读取：

```bash
chown 1000:1000 deploy/config.yaml
chmod 600 deploy/config.yaml deploy/compose.production.yaml
```

1Panel 的“路径选择”只接受一个 Compose 文件，不能把两个路径用逗号拼接。以下两种模式只能
选择一种。

保留 4.00 核、3840 MiB CPU/内存上限时生成受限文件：

```bash
./deploy/1panel/generate-compose-file.sh
```

完全不设置任何 CPU 配额、CPU 预留、内存上限或内存预留时生成无限资源文件：

```bash
./deploy/1panel/generate-unlimited-compose-file.sh
```

两个结果分别为 `/opt/r2rpc/compose.1panel.yaml` 和
`/opt/r2rpc/compose.1panel.unlimited.yaml`，都包含生产数据库密码，因此已被 Git 忽略并设置为
`600` 权限。无限资源文件仍保留各服务的 PID 上限，防止失控进程无限创建；Docker 不会限制其
CPU 和内存使用量。每次修改 `compose.yaml` 或 `deploy/compose.production.yaml` 后，都必须用
所选模式的脚本重新生成对应文件。

## 3. 校验并启动容器

先设置后续命令使用的编排文件。无限资源模式：

```bash
panel_compose_file=compose.1panel.unlimited.yaml
```

受限模式：

```bash
panel_compose_file=compose.1panel.yaml
```

不要在同一次部署中交替使用两个文件。然后用将要发布的后端镜像执行生产配置门禁：

```bash
docker run --rm \
  -v "$PWD/deploy/config.yaml:/app/config.yaml:ro" \
  ghcr.io/rezoch340/r2rpc-backend:v0.1.6 \
  node dist/scripts/check-production-config.js
```

门禁通过后拉取并启动：

```bash
docker compose \
  -f "$panel_compose_file" \
  pull

docker compose \
  -f "$panel_compose_file" \
  up -d --no-build
```

检查运行状态：

```bash
docker compose \
  -f "$panel_compose_file" \
  ps

docker inspect \
  -f '{{.Name}} exit={{.State.ExitCode}}' \
  r2rpc-migration-1 \
  r2rpc-seed-1
```

期望 PostgreSQL、Redis、Manticore、API 和 Frontend 为 `healthy`，Worker 为 `running`，
Migration 与 Seed 的退出码均为 `0`。宿主机仅监听：

```text
127.0.0.1:3000 API
127.0.0.1:3001 Frontend
127.0.0.1:5432 PostgreSQL
127.0.0.1:6379 Redis
127.0.0.1:9306/9308 Manticore
```

需要在面板中启停时，进入“容器 → 编排 → 创建编排 → 路径选择”，并且只选择与生成模式一致的
一个文件：

```text
受限模式：/opt/r2rpc/compose.1panel.yaml
无限资源模式：/opt/r2rpc/compose.1panel.unlimited.yaml
```

不要填写 `/opt/r2rpc/compose.yaml,/opt/r2rpc/deploy/compose.production.yaml`；1Panel 会把
整段内容当成一个文件名并返回 `stat ... no such file or directory`。1Panel 官方区分 Apps、
1Panel 和 Local 三类 Compose，只有由面板创建的 Compose 才提供完整启停控制。

## 4. 创建两个 1Panel 反向代理网站

进入“网站 → 创建网站 → 反向代理”，分别创建两个网站，不能批量创建到同一个上游。

### 4.1 管理控制台

| 字段 | 值 |
|---|---|
| 域名 | `console.your-domain.com` |
| 端口 | `80` |
| 代号 | `r2rpc-console` |
| 代理协议 | `http` |
| 代理地址 | `127.0.0.1:3001` |
| 备注 | `R2RPC 管理控制台` |

### 4.2 API 与设备 WebSocket

| 字段 | 值 |
|---|---|
| 域名 | `rpc.your-domain.com` |
| 端口 | `80` |
| 代号 | `r2rpc-api` |
| 代理协议 | `http` |
| 代理地址 | `127.0.0.1:3000` |
| 备注 | `R2RPC API 和设备 WebSocket` |

没有配置 AAAA 记录时不要开启“监听 IPv6”。创建完成后，两个网站都应设置为 HTTP 自动跳转
HTTPS。

## 5. 证书绑定

在“证书”中分别申请或导入覆盖两个域名的证书。可以使用一张 SAN/通配符证书，也可以为两个
域名各使用一张证书；单域名证书不能绑定给另一个站点。

在两个网站的“配置 → HTTPS”中选择与当前域名匹配的证书，并设置：

- HTTP 自动跳转 HTTPS；
- TLS 1.2 与 TLS 1.3；
- Cloudflare SSL/TLS 模式为 Full (strict)。

从宿主机核对实际证书，而不是只看 1Panel 下拉框：

```bash
openssl x509 \
  -in /opt/1panel/www/sites/r2rpc-console/ssl/fullchain.pem \
  -noout -subject -dates -ext subjectAltName

openssl x509 \
  -in /opt/1panel/www/sites/r2rpc-api/ssl/fullchain.pem \
  -noout -subject -dates -ext subjectAltName
```

两个输出的 SAN 必须分别包含控制台和 API 域名。

## 6. 安装 1Panel OpenResty 专用配置

仓库提供 1Panel 专用代理片段，解决以下问题：

- 普通 API 与 WebSocket 使用不同的超时和 Connection 语义；
- WebSocket 只在 `/api/client/ws` 执行 Upgrade；
- API 禁止缓存；
- 转发头覆盖客户端输入，不使用可注入的原始 `X-Forwarded-For`；
- Cloudflare 官方 IP 段转换为真实访问者地址；
- 设备 Token 所在的 WebSocket query 不进入自定义代理日志。

在两个网站代号使用默认值时直接执行：

```bash
cd /opt/r2rpc
deploy/1panel/install-openresty-config.sh
```

如果网站代号不同，依次传入 API 与控制台代号：

```bash
deploy/1panel/install-openresty-config.sh \
  actual-api-alias \
  actual-console-alias
```

脚本会：

1. 备份现有代理片段到 `/opt/1panel/backup/`；
2. 写入普通 API、WebSocket 和控制台代理配置；
3. 从 Cloudflare 官方端点刷新可信 IP 段；
4. 执行 `openresty -t`；
5. 仅在语法通过后 reload OpenResty。

常用文件位置：

```text
/opt/1panel/www/sites/r2rpc-api/proxy/root.conf
/opt/1panel/www/sites/r2rpc-api/proxy/websocket.conf
/opt/1panel/www/sites/r2rpc-console/proxy/root.conf
/opt/1panel/www/conf.d/00-r2rpc-cloudflare-real-ip.conf
/opt/1panel/www/conf.d/01-r2rpc-websocket-map.conf
```

这些路径属于 1Panel OpenResty，不要再同时安装系统 Nginx 版
`deploy/reverse-proxy/r2rpc.conf.example`，否则会造成 80/443 端口冲突。

## 7. Cloudflare 设置

DNS：

| 类型 | 名称 | 内容 | 状态 |
|---|---|---|---|
| A/AAAA/CNAME | `console` | 源站公网地址 | Proxied |
| A/AAAA/CNAME | `rpc` | 同一源站公网地址 | Proxied |

Cloudflare 控制台还需要：

1. SSL/TLS：Full (strict)；
2. Edge Certificates：Always Use HTTPS；
3. Network：WebSockets On；
4. `rpc.your-domain.com/*` Cache Rule：Bypass cache；
5. WAF/限速放行 `/api/client/ws` 的初始 Upgrade；
6. 不为承载设备 WSS 的 `rpc` 域名开启 Argo。

建议在 1Panel“计划任务”中创建每日 Shell 任务：

```bash
set -e
cd /opt/r2rpc
deploy/1panel/refresh-cloudflare-real-ip.sh
```

该任务会重新下载 Cloudflare 官方 IPv4/IPv6 网段，完成 OpenResty 配置测试后 reload。WebSocket
map 独立存放，因此刷新 IP 文件不会删除 Upgrade 变量。

## 8. 生产验收

先检查源站回环代理：

```bash
curl --resolve console.your-domain.com:443:127.0.0.1 \
  -I https://console.your-domain.com/login

curl --resolve rpc.your-domain.com:443:127.0.0.1 \
  -I https://rpc.your-domain.com/docs
```

预期控制台为 `200`，关闭 OpenAPI 后 `/docs` 为 `404`。

从服务器外执行完整入口检查：

```bash
deploy/reverse-proxy/check-production.sh \
  https://console.your-domain.com \
  https://rpc.your-domain.com
```

脚本必须全部通过：

- 控制台 HTTP `200`；
- `/docs` HTTP `404`；
- 未登录 `/auth/me` HTTP `401`；
- WebSocket 成功 Upgrade，未提供 Device Token 时按协议以 `4001` 关闭。

最后使用真实 Device Token 挂载 SDK 设备，分别执行自动路由和指定设备 Hello，并在请求日志中
确认 AppAudit Step、设备 ID、状态、耗时和系统审计闭环。

## 9. 更新、日志与回滚

完整的备份、标签切换、镜像替换、配置门禁、更新验收、回滚命令和实机记录见
[`R2RPC 1Panel 生产更新`](UPDATE.md)。本节只保留日常日志入口。

查看日志：

```bash
cd /opt/r2rpc
docker compose \
  -f "${panel_compose_file:-compose.1panel.yaml}" \
  logs --tail=200 api worker frontend
```

Seed 日志可能包含初始管理员密码，不应未经处理后复制到公开记录。更新不能只处理 API，
Migration、Seed、Worker 和 Frontend 必须使用同一发布版本。

## 10. 官方参考

- [1Panel 创建反向代理网站](https://1panel.cn/docs/v2/user_manual/websites/website_create/)
- [1Panel 网站 HTTPS 与真实 IP 配置](https://1panel.cn/docs/v2/user_manual/websites/website_config_basic/)
- [1Panel Docker Compose 管理](https://1panel.cn/docs/v2/user_manual/containers/compose/)
- [Cloudflare WebSockets](https://developers.cloudflare.com/network/websockets/)
- [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)
- [Cloudflare IP 地址](https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/)
- [Nginx WebSocket 反向代理](https://nginx.org/en/docs/http/websocket.html)
