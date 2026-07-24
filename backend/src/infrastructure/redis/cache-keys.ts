import { createHash } from 'node:crypto';

function tokenDigest(plaintextToken: string): string {
  return createHash('sha256').update(plaintextToken).digest('hex');
}

export function accessTokenCacheKey(plaintextToken: string): string {
  return `invoke:token:${tokenDigest(plaintextToken)}`;
}

export function deviceTokenCacheKey(plaintextToken: string): string {
  return `ws:devtoken:${tokenDigest(plaintextToken)}`;
}

export function userAuthorizationCacheKey(userId: number): string {
  return `rbac:authorization:user:${userId}`;
}
