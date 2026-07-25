#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../.." && pwd)"
cloudflare_configuration_file="${1:-/opt/1panel/www/conf.d/00-r2rpc-cloudflare-real-ip.conf}"

"${repository_root}/deploy/reverse-proxy/update-cloudflare-real-ip.sh" \
  "${cloudflare_configuration_file}"

openresty_container="$(
  docker ps \
    --filter 'name=1Panel-openresty' \
    --format '{{.Names}}' |
    head -1
)"

if [[ -z "${openresty_container}" ]]; then
  printf '未找到运行中的 1Panel OpenResty 容器。\n' >&2
  exit 1
fi

docker exec "${openresty_container}" openresty -t
docker exec "${openresty_container}" openresty -s reload
printf 'Cloudflare 真实来源地址已更新并重载 OpenResty。\n'
