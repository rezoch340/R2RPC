#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
base_compose_file="${repository_root}/compose.yaml"
production_compose_file="${PRODUCTION_COMPOSE_FILE:-${repository_root}/deploy/compose.production.yaml}"
panel_compose_file="${PANEL_COMPOSE_FILE:-${repository_root}/compose.1panel.unlimited.yaml}"
temporary_directory="$(mktemp -d)"
expanded_compose_json_file="${temporary_directory}/expanded-compose.json"
unlimited_compose_json_file="${temporary_directory}/unlimited-compose.json"
generated_compose_file="${temporary_directory}/compose.1panel.unlimited.yaml"
validated_compose_json_file="${temporary_directory}/validated-compose.json"

trap 'rm -rf "${temporary_directory}"' EXIT

for required_file in "${base_compose_file}" "${production_compose_file}"; do
  [[ -f "${required_file}" ]] || {
    printf '缺少 Compose 文件：%s\n' "${required_file}" >&2
    exit 1
  }
done

command -v docker >/dev/null || {
  printf '缺少 docker 命令。\n' >&2
  exit 1
}

command -v python3 >/dev/null || {
  printf '缺少 python3 命令。\n' >&2
  exit 1
}

docker compose \
  --project-directory "${repository_root}" \
  --profile '*' \
  -f "${base_compose_file}" \
  -f "${production_compose_file}" \
  config \
  --no-path-resolution \
  --format json \
  > "${expanded_compose_json_file}"

python3 - "${expanded_compose_json_file}" "${unlimited_compose_json_file}" <<'PYTHON'
import json
import sys
from pathlib import Path

expanded_compose_json_file = Path(sys.argv[1])
unlimited_compose_json_file = Path(sys.argv[2])

with expanded_compose_json_file.open(encoding="utf-8") as expanded_compose_stream:
    compose_configuration = json.load(expanded_compose_stream)

for extension_name in tuple(compose_configuration):
    if extension_name.startswith("x-"):
        compose_configuration.pop(extension_name)

for service_configuration in compose_configuration.get("services", {}).values():
    for resource_field_name in tuple(service_configuration):
        if resource_field_name.startswith(("cpu", "mem")):
            service_configuration.pop(resource_field_name)

    deployment_configuration = service_configuration.get("deploy")
    if not isinstance(deployment_configuration, dict):
        continue

    resource_configuration = deployment_configuration.get("resources")
    if not isinstance(resource_configuration, dict):
        continue

    for resource_category in ("limits", "reservations"):
        resource_category_configuration = resource_configuration.get(resource_category)
        if not isinstance(resource_category_configuration, dict):
            continue

        resource_category_configuration.pop("cpus", None)
        resource_category_configuration.pop("memory", None)
        if not resource_category_configuration:
            resource_configuration.pop(resource_category)

    if not resource_configuration:
        deployment_configuration.pop("resources")
    if not deployment_configuration:
        service_configuration.pop("deploy")

with unlimited_compose_json_file.open("w", encoding="utf-8") as unlimited_compose_stream:
    json.dump(compose_configuration, unlimited_compose_stream, indent=2)
    unlimited_compose_stream.write("\n")
PYTHON

docker compose \
  --project-directory "${repository_root}" \
  --profile '*' \
  -f "${unlimited_compose_json_file}" \
  config \
  --no-path-resolution \
  --output "${generated_compose_file}"

docker compose \
  --project-directory "${repository_root}" \
  --profile '*' \
  -f "${generated_compose_file}" \
  config \
  --no-path-resolution \
  --format json \
  > "${validated_compose_json_file}"

python3 - \
  "${expanded_compose_json_file}" \
  "${validated_compose_json_file}" <<'PYTHON'
import json
import sys
from pathlib import Path

expanded_compose_json_file = Path(sys.argv[1])
validated_compose_json_file = Path(sys.argv[2])

with expanded_compose_json_file.open(encoding="utf-8") as expanded_compose_stream:
    expanded_compose_configuration = json.load(expanded_compose_stream)

with validated_compose_json_file.open(encoding="utf-8") as validated_compose_stream:
    validated_compose_configuration = json.load(validated_compose_stream)

expanded_services = expanded_compose_configuration.get("services", {})
validated_services = validated_compose_configuration.get("services", {})

if set(expanded_services) != set(validated_services):
    raise SystemExit("无限资源 Compose 的服务集合与生产编排不一致。")

violations = []
for service_name, service_configuration in validated_services.items():
    for resource_field_name in service_configuration:
        if resource_field_name.startswith(("cpu", "mem")):
            violations.append(f"{service_name}.{resource_field_name}")

    deployment_configuration = service_configuration.get("deploy", {})
    resource_configuration = deployment_configuration.get("resources", {})
    for resource_category in ("limits", "reservations"):
        resource_category_configuration = resource_configuration.get(resource_category, {})
        for resource_field_name in ("cpus", "memory"):
            if resource_field_name in resource_category_configuration:
                violations.append(
                    f"{service_name}.deploy.resources.{resource_category}.{resource_field_name}"
                )

    expected_process_limit = expanded_services[service_name].get("pids_limit")
    actual_process_limit = service_configuration.get("pids_limit")
    if expected_process_limit != actual_process_limit:
        violations.append(f"{service_name}.pids_limit")

if violations:
    violation_list = ", ".join(sorted(violations))
    raise SystemExit(f"无限资源 Compose 校验失败：{violation_list}")
PYTHON

docker compose \
  --project-directory "${repository_root}" \
  --profile '*' \
  -f "${generated_compose_file}" \
  config \
  --quiet

install -m 600 "${generated_compose_file}" "${panel_compose_file}"

printf '已生成不限制 CPU 和内存的 1Panel 单文件 Compose：%s\n' "${panel_compose_file}"
