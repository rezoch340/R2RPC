import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '../../infrastructure/config/config.service';
import {
  UserAuthorizationCacheService,
  UserAuthorizationSnapshot,
} from '../../infrastructure/redis/user-authorization-cache.service';
import { RbacService } from '../rbac/rbac.service';

export interface JwtPayload {
  sub: number | string;
  username: string;
}

// JWT 校验策略:从 Authorization: Bearer 取 token,用 config.jwt.secret 验签
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configuration: ConfigService,
    private readonly rbacService: RbacService,
    private readonly userAuthorizationCacheService: UserAuthorizationCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configuration.jwt.secret,
    });
  }

  // 返回值挂到 request.user;附带加载权限列表 + isRoot,供 PermissionGuard 消费
  async validate(payload: JwtPayload) {
    const userId = Number(payload.sub);
    const authorization = await this.userAuthorizationCacheService.getOrLoad(
      userId,
      async () => {
        // 先确认用户存在且未软删——已删用户的旧 JWT 必须失效(否则关联权限仍会加载)
        const user = await this.rbacService.findAuthUser(userId);
        if (!user) {
          throw new UnauthorizedException('账号不存在或已删除');
        }
        if (!user.enabled) {
          throw new ForbiddenException('账号已禁用');
        }
        return {
          isRoot: user.isRoot,
          enabled: user.enabled,
          permissions: await this.rbacService.getUserPermissions(userId),
        };
      },
    );
    return this.buildAuthenticatedUser(payload, authorization);
  }

  private buildAuthenticatedUser(
    payload: JwtPayload,
    authorization: UserAuthorizationSnapshot,
  ) {
    if (!authorization.enabled) {
      throw new ForbiddenException('账号已禁用');
    }
    return {
      id: Number(payload.sub),
      sub: payload.sub,
      username: payload.username,
      permissions: authorization.permissions,
      isRoot: authorization.isRoot,
    };
  }
}
