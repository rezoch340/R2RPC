#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
api_website_alias="${1:-r2rpc-api}"
console_website_alias="${2:-r2rpc-console}"
api_proxy_directory="/opt/1panel/www/sites/${api_website_alias}/proxy"
console_proxy_directory="/opt/1panel/www/sites/${console_website_alias}/proxy"
global_configuration_directory="/opt/1panel/www/conf.d"
backup_directory="/opt/1panel/backup/r2rpc-openresty-$(date +%Y%m%d-%H%M%S)"

for required_directory in \
  "${api_proxy_directory}" \
  "${console_proxy_directory}" \
  "${global_configuration_directory}"; do
  if [[ ! -d "${required_directory}" ]]; then
    printf '1Panel 目录不存在: %s\n' "${required_directory}" >&2
    exit 1
  fi
done

mkdir -p "${backup_directory}"
cp -a "${api_proxy_directory}" "${backup_directory}/${api_website_alias}-proxy"
cp -a "${console_proxy_directory}" "${backup_directory}/${console_website_alias}-proxy"

install -m 0644 \
  "${script_directory}/r2rpc-api-root.conf.example" \
  "${api_proxy_directory}/root.conf"
install -m 0644 \
  "${script_directory}/r2rpc-api-websocket.conf.example" \
  "${api_proxy_directory}/websocket.conf"
install -m 0644 \
  "${script_directory}/r2rpc-console-root.conf.example" \
  "${console_proxy_directory}/root.conf"
install -m 0644 \
  "${script_directory}/r2rpc-websocket-map.conf.example" \
  "${global_configuration_directory}/01-r2rpc-websocket-map.conf"

"${script_directory}/refresh-cloudflare-real-ip.sh"
printf '1Panel OpenResty 配置已安装，备份目录: %s\n' "${backup_directory}"
