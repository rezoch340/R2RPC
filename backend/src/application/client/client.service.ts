import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
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
  // 设备账号建组待 Task 1.3 接入 client_groups(fail-closed,避免静默丢弃 group)
  async createAccount(input: { clientId: string; group: string; secret: string }) {
    throw new ServiceUnavailableException('设备账号建组待 Task 1.3 启用');
  }

  async list() {
    return this.db
      .select({
        id: clients.id,
        clientId: clients.clientId,
        createdAt: clients.createdAt,
      })
      .from(clients);
  }

  // 手机端登录:校验凭据,签发 client JWT + 返回 wsUrl
  // 分组登录待 Task 1.3 接入 client_groups;在此之前不签发任意组 token(fail-closed)
  async login(clientId: string, group: string, secret: string) {
    const acc = await this.findByClientId(clientId);
    if (!acc || !verifyPassword(secret, acc.secretHash)) {
      throw new UnauthorizedException('设备登录凭据无效');
    }
    throw new ServiceUnavailableException('设备分组登录待 Task 1.3(client_groups)启用');
  }
}
