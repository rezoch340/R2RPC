import { Injectable } from '@nestjs/common';
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
    cfg: ConfigService,
    private readonly rbac: RbacService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.jwt.secret,
    });
  }

  // 返回值挂到 request.user;附带加载权限列表 + isRoot,供 PermissionGuard 消费
  // ponytail: 每请求查 permissions+isRoot,流量/PG 成瓶颈时对 (userId→perms,isRoot) 上短 TTL cache-aside、RBAC 写路径删 key
  async validate(payload: JwtPayload) {
    const id = Number(payload.sub);
    const [permissions, isRoot] = await Promise.all([
      this.rbac.getUserPermissions(id),
      this.rbac.isRoot(id),
    ]);
    return {
      id,
      sub: payload.sub,
      username: payload.username,
      permissions,
      isRoot,
    };
  }
}
