import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyPassword } from '../../common/utils/password';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  // 管理员登录:校验用户名密码,签发 JWT
  async login(username: string, password: string) {
    const user = await this.users.findByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (!user.enabled) {
      throw new ForbiddenException('账号已禁用');
    }
    const token = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
    });
    // last_login 是记录性信息,best-effort:写失败不阻断登录
    void this.users.updateLastLogin(user.id).catch(() => undefined);
    return {
      token,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }
}
