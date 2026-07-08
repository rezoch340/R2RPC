import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '../../infrastructure/config/config.service';

export interface JwtPayload {
  sub: number | string;
  username: string;
  role: string;
  roles?: string[];
}

// JWT 校验策略:从 Authorization: Bearer 取 token,用 config.jwt.secret 验签
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.jwt.secret,
    });
  }

  // 返回值挂到 request.user
  validate(payload: JwtPayload) {
    return {
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      roles: payload.roles ?? [payload.role],
    };
  }
}
