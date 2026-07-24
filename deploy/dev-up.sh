#!/usr/bin/env sh
# 一键拉起开发环境:起基础设施 -> 等就绪 -> 迁移 -> 种子管理员
set -eu

HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$HERE/.."
BACKEND="$ROOT/backend"
COMPOSE_FILE="$ROOT/compose.yaml"

if [ ! -f "$ROOT/config.yaml" ]; then
  cp "$ROOT/config.example.yaml" "$ROOT/config.yaml"
  echo "==> 已生成宿主机配置: config.yaml"
fi
if [ ! -f "$HERE/config.yaml" ]; then
  cp "$HERE/config.example.yaml" "$HERE/config.yaml"
  echo "==> 已生成 Compose 配置: deploy/config.yaml"
fi

echo "==> 启动基础设施 (postgres / redis / manticore)"
docker compose -f "$COMPOSE_FILE" up -d postgres redis manticore

echo "==> 等待 Postgres 就绪"
until docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U r2rpc -d r2rpc >/dev/null 2>&1; do
  sleep 1
done

echo "==> 等待 Redis 就绪"
until docker compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping >/dev/null 2>&1; do
  sleep 1
done

echo "==> 执行数据库迁移 (drizzle-kit migrate)"
cd "$BACKEND"
pnpm db:migrate

echo "==> 种子管理员账号"
pnpm seed:admin

echo ""
echo "完成。启动服务:"
echo "  cd backend && pnpm dev:api       # API + WS 网关 + Swagger(/docs)"
echo "  cd backend && pnpm dev:worker    # BullMQ worker"
