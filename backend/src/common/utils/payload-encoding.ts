import { gzipSync, gunzipSync } from 'node:zlib';

// 协议 payloadEncoding = gzip+base64+json:对象 -> gzip -> base64 字符串
export function encodePayload(value: unknown): string {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64');
}

// 反向:base64 字符串 -> gunzip -> 对象
export function decodePayload<T = unknown>(encoded: string): T {
  return JSON.parse(
    gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'),
  ) as T;
}
