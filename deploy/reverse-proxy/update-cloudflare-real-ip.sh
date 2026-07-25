#!/usr/bin/env bash

set -Eeuo pipefail

output_file="${1:-/etc/nginx/conf.d/cloudflare-real-ip.conf}"
temporary_file="$(mktemp)"

command -v curl >/dev/null
command -v install >/dev/null

cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

write_address_ranges() {
  local address_family="$1"
  local source_url="$2"
  local address_range
  local address_range_count=0

  while IFS= read -r address_range; do
    [[ -z "$address_range" ]] && continue
    if [[ "$address_family" == "ipv4" ]]; then
      [[ "$address_range" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] || {
        printf 'Cloudflare IPv4 地址段格式非法: %s\n' "$address_range" >&2
        exit 1
      }
    else
      [[ "$address_range" =~ ^[0-9A-Fa-f:]+/[0-9]{1,3}$ ]] || {
        printf 'Cloudflare IPv6 地址段格式非法: %s\n' "$address_range" >&2
        exit 1
      }
    fi
    printf 'set_real_ip_from %s;\n' "$address_range"
    address_range_count=$((address_range_count + 1))
  done < <(curl --fail --silent --show-error "$source_url")

  if [[ "$address_range_count" -eq 0 ]]; then
    printf 'Cloudflare %s 地址段为空\n' "$address_family" >&2
    exit 1
  fi
}

{
  printf '# 由 update-cloudflare-real-ip.sh 生成，请勿手工维护。\n'
  write_address_ranges "ipv4" "https://www.cloudflare.com/ips-v4"
  write_address_ranges "ipv6" "https://www.cloudflare.com/ips-v6"
  printf 'real_ip_header CF-Connecting-IP;\n'
  printf 'real_ip_recursive on;\n'
} >"$temporary_file"

install -m 0644 "$temporary_file" "$output_file"
printf 'Cloudflare 真实来源地址配置已写入: %s\n' "$output_file"
