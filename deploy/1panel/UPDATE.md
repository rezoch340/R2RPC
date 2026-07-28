# R2RPC 1Panel 生产更新

本文用于已经按照[`README.md`](README.md)部署到 `/opt/r2rpc` 的生产环境。首次安装、域名、
OpenResty、Cloudflare 和证书配置仍以部署文档为准。

文中以 `v0.1.4` 为目标版本示例。更新其他版本时只修改 `target_version`，不要直接复制新的
`deploy/config.production.example.yaml` 或 `deploy/compose.production.example.yaml` 覆盖生产文件。

## 更新原则

- 先备份，再切换标签和重建容器。
- `deploy/config.yaml`、`deploy/compose.production.yaml` 和所选 `compose.1panel*.yaml` 含生产配置，
  均已被 Git 忽略，切换标签不会自动更新或覆盖它们。
- Migration、Seed、API、Worker 和 Performance 必须使用同一个 Backend 版本，Frontend 使用
  同版本的 Frontend 镜像；不能只更新 API。
- 1Panel 始终只选择一个与资源模式一致的 `compose.1panel*.yaml`，不能填写逗号分隔的多个
  Compose 路径，也不能在一次更新中切换文件。
- 不得执行 `docker compose down -v`，该命令会删除生产命名卷。

## 1. 更新前检查

1Panel 的“终端”提示符以 `root@` 开头时已经是 root shell，不要再次执行 `sudo -i`，否则会
启动嵌套登录 shell 并回到 `/root`。只有当前用户不是 root 时，才先单独执行 `sudo -i`，等待
出现 root 提示符后再继续。定义本次目标版本：

```bash
cd /opt/r2rpc

target_version=v0.1.4
repository_directory=/opt/r2rpc
backup_directory="/opt/r2rpc-backups/$(date +%Y%m%d-%H%M%S)"

# 保持现有部署的资源模式。受限模式使用下面两行。
panel_compose_file=compose.1panel.yaml
compose_generation_script=./deploy/1panel/generate-compose-file.sh

# 无限资源模式改用下面两行，不要混用两种模式。
# panel_compose_file=compose.1panel.unlimited.yaml
# compose_generation_script=./deploy/1panel/generate-unlimited-compose-file.sh

git describe --tags --exact-match
docker compose -f "$panel_compose_file" ps
df -h /opt /var/lib/docker
```

更新前必须确认 PostgreSQL、Redis、Manticore 和 API 健康，Worker 正在运行，并预留足够空间
保存数据库备份与新镜像。

同时阅读目标版本的 GitHub Release 和 `CHANGELOG.md`，确认是否包含数据库迁移、配置字段变化
或不兼容协议变更。

## 2. 备份数据库和生产文件

PostgreSQL 逻辑备份可以在服务运行期间完成：

```bash
mkdir -p "$backup_directory"
chmod 700 "$backup_directory"

docker compose -f "$panel_compose_file" exec -T postgres \
  pg_dump -U r2rpc -d r2rpc -Fc \
  > "$backup_directory/postgres.dump"

cp deploy/config.yaml \
   deploy/compose.production.yaml \
   "$panel_compose_file" \
   "$backup_directory/"

test -s "$backup_directory/postgres.dump"
sha256sum "$backup_directory/postgres.dump" \
  > "$backup_directory/postgres.dump.sha256"
```

还应通过 1Panel 或宿主机快照工具备份以下命名卷：

```text
r2rpc_postgres-data
r2rpc_redis-data
r2rpc_manticore-data
```

PostgreSQL 恢复以 `postgres.dump` 为权威来源。文件系统级卷备份必须使用支持一致性快照的工具，
不要在数据库持续写入时直接打包数据目录。

## 3. 获取并切换目标标签

```bash
cd "$repository_directory"

git fetch --tags origin
git rev-parse --verify "refs/tags/${target_version}^{commit}"
git switch --detach "$target_version"
git describe --tags --exact-match
```

最后一条必须精确输出目标版本。切换完成后再次确认三个生产文件仍然存在：

```bash
test -f deploy/config.yaml
test -f deploy/compose.production.yaml
test -f "$panel_compose_file"
```

## 4. 更新全部 R2RPC 镜像标签

只替换生产覆盖文件中的 R2RPC 镜像版本，不覆盖数据库密码和其他生产配置：

```bash
sed -i -E \
  "s#(ghcr\.io/rezoch340/r2rpc-(backend|frontend)):v[0-9]+\.[0-9]+\.[0-9]+#\1:${target_version}#g" \
  deploy/compose.production.yaml

grep 'image:' deploy/compose.production.yaml
```

当前编排应输出 6 条 R2RPC 镜像，其中 5 条 Backend 和 1 条 Frontend。可以使用下面的门禁防止
遗漏：

```bash
target_image_reference_count="$(
  grep -Fc ":${target_version}" deploy/compose.production.yaml
)"
test "$target_image_reference_count" -eq 6
```

重新生成 1Panel 使用的单一 Compose 文件：

```bash
"$compose_generation_script"
docker compose -f "$panel_compose_file" config --quiet
```

不要手工编辑所选 `compose.1panel*.yaml`；它每次都应由基础编排和生产覆盖文件重新生成。无限
资源模式必须继续运行无限资源脚本，否则会在更新时重新引入 4 核、3840 MiB 上限。

## 5. 校验配置并预拉取镜像

先用目标 Backend 镜像读取真实生产配置：

```bash
docker run --rm \
  -v "$PWD/deploy/config.yaml:/app/config.yaml:ro" \
  "ghcr.io/rezoch340/r2rpc-backend:${target_version}" \
  node dist/scripts/check-production-config.js
```

只有输出 `生产配置检查通过` 才能继续：

```bash
docker compose -f "$panel_compose_file" pull
```

先完成配置检查和镜像拉取，再重建容器，可以缩短生产不可用窗口。

## 6. 执行更新

```bash
docker compose -f "$panel_compose_file" \
  up -d --no-build --wait --wait-timeout 180
```

Compose 会按以下顺序处理依赖：PostgreSQL healthy -> Migration 成功 -> Seed 成功 -> API、
Worker 和 Frontend。已有 PostgreSQL、Redis 和 Manticore 数据卷不会被删除。

## 7. 验收容器、版本和日志

```bash
docker compose -f "$panel_compose_file" ps

docker inspect \
  -f '{{.Name}} image={{.Config.Image}} exit={{.State.ExitCode}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
  r2rpc-migration-1 \
  r2rpc-seed-1 \
  r2rpc-api-1 \
  r2rpc-worker-1 \
  r2rpc-frontend-1
```

验收标准：

- PostgreSQL、Redis、Manticore、API 和 Frontend 为 `healthy`；
- Worker 为 `running`；
- Migration 与 Seed 的退出码均为 `0`；
- Migration、Seed、API 和 Worker 使用目标 Backend 镜像；
- Frontend 使用目标 Frontend 镜像。

Frontend 刚启动时可能短暂显示 `health: starting`。等待后重查，不要把启动中误判为更新失败：

```bash
sleep 15
docker compose -f "$panel_compose_file" ps frontend
```

查看必要日志：

```bash
docker compose -f "$panel_compose_file" \
  logs --tail=200 api worker frontend migration
```

Seed 会输出初始管理员信息，日志可能包含生产初始密码。默认只检查 Seed 退出码；必须排障时在
服务器本地查看，禁止把未经处理的完整 Seed 日志提交到仓库、Issue 或聊天记录。

## 8. HTTP、WebSocket 与真实设备验收

先检查宿主机入口：

```bash
curl -sS -o /dev/null -w 'frontend=%{http_code}\n' http://127.0.0.1:3001/
curl -sS -o /dev/null -w 'auth=%{http_code}\n' http://127.0.0.1:3000/auth/me
curl -sS -o /dev/null -w 'openapi=%{http_code}\n' http://127.0.0.1:3000/docs
```

生产预期为 Frontend `200`、未登录 `/auth/me` 为 `401`、关闭的 `/docs` 为 `404`。然后执行
正式域名检查：

```bash
deploy/reverse-proxy/check-production.sh \
  https://console.your-domain.com \
  https://rpc.your-domain.com
```

最后使用真实 Device Token 完成：

1. 设备通过公网 WSS 上线；
2. Access Token 自动路由 Hello；
3. Access Token 指定 `clientId` Hello；
4. 后台手动 RPC 调试；
5. 请求日志、AppAudit Step 和系统日志查询。

## 9. 回滚

先查看目标版本是否执行了不可逆数据库迁移。如果当前 schema 仍兼容旧版本，可以按更新流程把
镜像和仓库标签切回：

```bash
rollback_version=v0.1.0

sed -i -E \
  "s#(ghcr\.io/rezoch340/r2rpc-(backend|frontend)):v[0-9]+\.[0-9]+\.[0-9]+#\1:${rollback_version}#g" \
  deploy/compose.production.yaml

# 先用当前版本的部署工具生成回滚编排；v0.1.0 标签还没有该生成脚本。
"$compose_generation_script"
docker compose -f "$panel_compose_file" pull

git switch --detach "$rollback_version"

docker compose -f "$panel_compose_file" \
  up -d --no-build --wait --wait-timeout 180
```

如果新版本已经写入旧版本无法读取的 schema 或数据，禁止只回退镜像。应停止业务写入，恢复
`postgres.dump` 和对应的 Redis/Manticore 快照，再启动上一版本。恢复步骤必须根据当次 Release
的迁移说明执行。

## 10. 1Panel 操作说明

升级不需要删除或重新创建 1Panel 编排。命令行更新完成后，1Panel 会显示同一 `r2rpc` Compose
项目的新容器。面板中的编排路径必须与本次更新所选模式一致，并且只能选择其中一个：

```text
受限模式：/opt/r2rpc/compose.1panel.yaml
无限资源模式：/opt/r2rpc/compose.1panel.unlimited.yaml
```

禁止填写：

```text
/opt/r2rpc/compose.yaml,/opt/r2rpc/deploy/compose.production.yaml
```

逗号分隔路径会被 1Panel 当成一个不存在的文件名。

## 11. v0.1.0 -> v0.1.1 实机验证记录

2026-07-28 在 Ubuntu 22.04、1Panel v2.0.15、Docker Compose 2.28 的既有生产编排上完成更新。
以下记录由生产终端输出整理，已删除主机标识、域名和管理员初始密码。

```text
Previous HEAD position was 0b60f56 ...
HEAD is now at 788611c ...
v0.1.1

Digest: sha256:3f060eb4cf0f22a0145ddf1afecb603dea42d29053d9ee5714c73bd387b866fd
Status: Downloaded newer image for ghcr.io/rezoch340/r2rpc-backend:v0.1.1
生产配置检查通过

Container r2rpc-postgres-1   Healthy
Container r2rpc-redis-1      Healthy
Container r2rpc-manticore-1  Healthy
Container r2rpc-migration-1  Exited
Container r2rpc-seed-1       Exited
Container r2rpc-api-1        Healthy
Container r2rpc-worker-1     Started
Container r2rpc-frontend-1   Started (health: starting)

/r2rpc-migration-1 image=ghcr.io/rezoch340/r2rpc-backend:v0.1.1 exit=0
/r2rpc-seed-1 image=ghcr.io/rezoch340/r2rpc-backend:v0.1.1 exit=0
/r2rpc-api-1 image=ghcr.io/rezoch340/r2rpc-backend:v0.1.1 exit=0
/r2rpc-worker-1 image=ghcr.io/rezoch340/r2rpc-backend:v0.1.1 exit=0
/r2rpc-frontend-1 image=ghcr.io/rezoch340/r2rpc-frontend:v0.1.1 exit=0

Nest application successfully started
worker 进程已启动(请求日志消费 + 死信补偿 + repair)
迁移完成
```

本次版本没有新增数据库迁移；现有 PostgreSQL 与 Manticore 容器保持运行，R2RPC 应用容器和
Redis 按新编排重建。更新后仍需等待 Frontend 健康检查完成，并执行正式域名与真实设备验收。
