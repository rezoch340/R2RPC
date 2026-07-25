#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_full_blackbox=false
compose_project_name="r2rpc-local-ci"
compose_started=false
compose_configuration_file="./deploy/config.example.yaml"

print_usage() {
  cat <<'USAGE'
用法: ./scripts/local-ci.sh [--full]

默认执行后端与前端的本地质量门禁。
--full 额外启动隔离的 Compose 项目并执行 HTTP/WebSocket 与浏览器黑盒。
USAGE
}

print_stage() {
  printf '\n==> %s\n' "$1"
}

run_compose() {
  CONFIG_FILE="$compose_configuration_file" docker compose --project-name "$compose_project_name" "$@"
}

cleanup() {
  local command_status=$?
  trap - EXIT

  if [[ "$compose_started" == "true" ]]; then
    if [[ "$command_status" -ne 0 ]]; then
      run_compose logs --no-color || true
    fi
    run_compose down --volumes --remove-orphans || true
  fi

  exit "$command_status"
}

for requested_argument in "$@"; do
  case "$requested_argument" in
    --full)
      run_full_blackbox=true
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      printf '未知参数: %s\n' "$requested_argument" >&2
      print_usage >&2
      exit 2
      ;;
  esac
done

trap cleanup EXIT
cd "$repository_root"

if [[ "$(node --version)" != v24.* ]]; then
  printf '本地质量门禁要求 Node.js 24，当前版本为 %s\n' "$(node --version)" >&2
  exit 1
fi

command -v corepack >/dev/null
command -v docker >/dev/null

print_stage "安装锁定依赖"
(cd backend && corepack pnpm install --frozen-lockfile)
(cd frontend && corepack pnpm install --frozen-lockfile)

print_stage "后端质量门禁"
(
  cd backend
  corepack pnpm lint:check
  corepack pnpm exec prettier --check "src/**/*.ts" "test/**/*.{js,ts}"
  corepack pnpm build
  corepack pnpm test
  CONFIG_FILE=../config.example.yaml corepack pnpm openapi:gen
  CONFIG_FILE=../config.example.yaml corepack pnpm db:generate
)

generated_changes="$(git status --porcelain -- backend/drizzle docs/openapi.yaml)"
if [[ -n "$generated_changes" ]]; then
  printf 'OpenAPI 或 Drizzle 生成结果未提交:\n%s\n' "$generated_changes" >&2
  exit 1
fi

print_stage "前端质量门禁"
(
  cd frontend
  corepack pnpm lint
  corepack pnpm build
)

print_stage "Compose 配置校验"
run_compose config --quiet

if [[ "$run_full_blackbox" == "true" ]]; then
  print_stage "启动本地 Compose 黑盒环境"
  compose_started=true
  run_compose up --detach --build --wait api worker frontend
  run_compose ps

  print_stage "后端 HTTP/WebSocket 黑盒"
  (cd backend && BASE_URL=http://127.0.0.1:3000 corepack pnpm smoke)

  print_stage "前端浏览器黑盒"
  (
    cd frontend
    corepack pnpm exec playwright install chromium
    CONFIG_FILE=../config.example.yaml \
      E2E_FRONTEND_PORT=3001 \
      E2E_REUSE_EXISTING_SERVER=true \
      corepack pnpm test:e2e
  )
fi

print_stage "本地质量门禁通过"
