import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '../../infrastructure/config/config.service';
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
    private readonly rbac: RbacService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configuration.jwt.secret,
    });
  }

  // 返回值挂到 request.user;附带加载权限列表 + isRoot,供 PermissionGuard 消费
  // ponytail: 每请求查 permissions+isRoot,流量/PG 成瓶颈时对 (userId→perms,isRoot) 上短 TTL cache-aside、RBAC 写路径删 key
  async validate(payload: JwtPayload) {
    const userId = Number(payload.sub);
    // 先确认用户存在且未软删——已删用户的旧 JWT 必须失效(否则关联权限仍会加载)
    const user = await this.rbac.findAuthUser(userId);
    if (!user) {
      throw new UnauthorizedException('账号不存在或已删除');
    }
    if (!user.enabled) {
      throw new ForbiddenException('账号已禁用');
    }
    const permissions = await this.rbac.getUserPermissions(userId);
    return {
      id: userId,
      sub: payload.sub,
      username: payload.username,
      permissions,
      isRoot: user.isRoot,
    };
  }
}
