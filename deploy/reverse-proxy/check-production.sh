#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$#" -ne 2 ]]; then
  printf '用法: %s <控制台 HTTPS URL> <API HTTPS URL>\n' "$0" >&2
  printf '示例: %s https://console.example.com https://rpc.example.com\n' "$0" >&2
  exit 2
fi

console_url="${1%/}"
api_url="${2%/}"

command -v curl >/dev/null
command -v node >/dev/null
node -e "if (typeof WebSocket === 'undefined') process.exit(1)"

check_status() {
  local description="$1"
  local expected_status="$2"
  shift 2
  local actual_status

  actual_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$@")"
  if [[ "$actual_status" != "$expected_status" ]]; then
    printf '%s失败: 期望 HTTP %s，实际 HTTP %s\n' \
      "$description" "$expected_status" "$actual_status" >&2
    exit 1
  fi
  printf '%s通过: HTTP %s\n' "$description" "$actual_status"
}

check_status "控制台入口" "200" --location "$console_url/login"
check_status "运行时 OpenAPI 已关闭" "404" "$api_url/docs"
check_status "API 鉴权入口" "401" "$api_url/auth/me"

API_URL="$api_url" node <<'NODE'
const apiUrl = process.env.API_URL;
const websocketUrl = new URL('/api/client/ws?clientId=release-check', apiUrl);
websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';

const timeoutTimer = setTimeout(() => {
  console.error('WebSocket 代理校验超时');
  process.exit(1);
}, 10_000);
const websocket = new WebSocket(websocketUrl);

websocket.addEventListener('close', (event) => {
  clearTimeout(timeoutTimer);
  if (event.code !== 4001) {
    console.error(`WebSocket 代理返回非预期关闭码: ${event.code}`);
    process.exit(1);
  }
  console.log('WebSocket Upgrade 与未授权关闭码校验通过: 4001');
  process.exit(0);
});
websocket.addEventListener('error', () => {
  clearTimeout(timeoutTimer);
  console.error('WebSocket 代理连接失败');
  process.exit(1);
});
NODE

printf '生产入口基础验收通过\n'
