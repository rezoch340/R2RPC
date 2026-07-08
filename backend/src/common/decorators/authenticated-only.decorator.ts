import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_ONLY_KEY = 'authenticatedOnly';
// 标注:只需已认证(有有效 JWT),不需要具体 @RequirePermission。用于 /auth/me 这类"看自己"的端点。
export const AuthenticatedOnly = () =>
  SetMetadata(AUTHENTICATED_ONLY_KEY, true);
