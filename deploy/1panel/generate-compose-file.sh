#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
base_compose_file="${repository_root}/compose.yaml"
production_compose_file="${repository_root}/deploy/compose.production.yaml"
panel_compose_file="${repository_root}/compose.1panel.yaml"

for required_file in "${base_compose_file}" "${production_compose_file}"; do
  [[ -f "${required_file}" ]] || {
    printf '缺少 Compose 文件：%s\n' "${required_file}" >&2
    exit 1
  }
done

docker compose \
  -f "${base_compose_file}" \
  -f "${production_compose_file}" \
  config \
  --no-path-resolution \
  --output "${panel_compose_file}"

chmod 600 "${panel_compose_file}"
docker compose -f "${panel_compose_file}" config --quiet

printf '已生成 1Panel 单文件 Compose：%s\n' "${panel_compose_file}"
