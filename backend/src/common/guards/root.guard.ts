import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthedRequest } from '../types/authed-request';

// 种子管理员身份闸：任何 RBAC 权限都不能替代 isRoot 身份。
@Injectable()
export class RootGuard implements CanActivate {
  canActivate(executionContext: ExecutionContext): boolean {
    const request = executionContext.switchToHttp().getRequest<AuthedRequest>();
    if (!request.user?.isRoot) {
      throw new ForbiddenException('仅种子管理员可执行此操作');
    }
    return true;
  }
}
