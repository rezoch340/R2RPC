import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../../common/utils/password';
import { ConfigService } from '../../infrastructure/config/config.service';
import { DbService } from '../../infrastructure/db/db.service';
import { clients } from './client.schema';

@Injectable()
export class ClientService {
  constructor(
    private readonly dbService: DbService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  async findByClientId(clientId: string) {
    const [row] = await this.db
      .select()
      .from(clients)
      .where(eq(clients.clientId, clientId))
      .limit(1);
    return row ?? null;
  }

  // 管理端:创建手机设备账号(secret 存 scrypt 哈希)
  async createAccount(input: { clientId: string; group: string; secret: string }) {
    if (await this.findByClientId(input.clientId)) {
      throw new ConflictException('clientId 已存在');
    }
    const [row] = await this.db
      .insert(clients)
      .values({
        clientId: input.clientId,
        groupName: input.group,
        secretHash: hashPassword(input.secret),
      })
      .returning({
        id: clients.id,
        clientId: clients.clientId,
        groupName: clients.groupName,
        createdAt: clients.createdAt,
      });
    return row;
  }

  async list() {
    return this.db
      .select({
        id: clients.id,
        clientId: clients.clientId,
        groupName: clients.groupName,
        createdAt: clients.createdAt,
      })
      .from(clients);
  }

  // 手机端登录:校验凭据,签发 client JWT + 返回 wsUrl
  async login(clientId: string, group: string, secret: string) {
    const acc = await this.findByClientId(clientId);
    if (!acc || acc.groupName !== group || !verifyPassword(secret, acc.secretHash)) {
      throw new UnauthorizedException('设备登录凭据无效');
    }
    const token = await this.jwt.signAsync({
      sub: clientId,
      clientId,
      group: acc.groupName,
      role: 'client',
      roles: ['client'],
    });
    const base =
      this.cfg.app.publicWsUrl ?? `ws://127.0.0.1:${this.cfg.app.port}`;
    return {
      token,
      wsUrl: `${base}/api/client/ws?token=${token}`,
      clientId,
      group: acc.groupName,
    };
  }
}
