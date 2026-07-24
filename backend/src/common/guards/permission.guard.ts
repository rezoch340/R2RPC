import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../../application/rbac/rbac.service';
import { AUTHENTICATED_ONLY_KEY } from '../decorators/authenticated-only.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from '../decorators/require-permission.decorator';
import type { AuthedRequest } from '../types/authed-request';

// 权限守卫:@Public 跳过;未声明 @RequirePermission 的接口 fail-closed 直接拒绝(防止漏标);
// root 用户绕过权限判断;其余用 CASL ability 校验 request.user.permissions
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthedRequest>();

    // 只需已认证、不需要具体权限的接口(如 /auth/me),JwtAuthGuard 已确保有 user,有就放行
    const authedOnly = this.reflector.getAllAndOverride<boolean>(
      AUTHENTICATED_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (authedOnly) {
      return !!user;
    }

    const required = this.reflector.get<RequiredPermission>(
      PERMISSION_KEY,
      context.getHandler(),
    );
    if (!required) {
      throw new ForbiddenException('未声明权限要求');
    }

    if (user?.isRoot) {
      return true;
    }

    const ability = this.rbac.buildAbility(user?.permissions ?? []);
    if (!ability.can(required.action, required.subject)) {
      throw new ForbiddenException(
        `缺少权限: ${required.action} ${required.subject}`,
      );
    }
    return true;
  }
}
