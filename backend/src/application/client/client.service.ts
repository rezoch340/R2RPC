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
import { GroupsService } from '../groups/groups.service';
import { clientGroups } from './client-groups.schema';
import { clients } from './client.schema';

@Injectable()
export class ClientService {
  constructor(
    private readonly dbService: DbService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly groups: GroupsService,
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

  // 管理端:创建手机设备账号(secret 存 scrypt 哈希),并按组名关联 client_groups
  // 组名不存在则建组;组成员关系是设备权限的唯一来源,不接受客户端自报
  async createAccount(input: {
    clientId: string;
    secret: string;
    groups: string[];
  }) {
    if (await this.findByClientId(input.clientId)) {
      throw new ConflictException('设备账号已存在');
    }
    const [row] = await this.db
      .insert(clients)
      .values({
        clientId: input.clientId,
        secretHash: hashPassword(input.secret),
      })
      .returning({
        id: clients.id,
        clientId: clients.clientId,
        createdAt: clients.createdAt,
      });

    for (const name of input.groups) {
      const groupId =
        (await this.groups.idByName(name)) ??
        (await this.groups.create(name)).id;
      await this.db.insert(clientGroups).values({ clientId: row.id, groupId });
    }
    return row;
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

  // 手机端登录:校验凭据,查设备所属组(client_groups,来源可信,非客户端自报)→ 签发多组 client JWT + 返回 wsUrl
  async login(clientId: string, secret: string) {
    const acc = await this.findByClientId(clientId);
    if (!acc || !verifyPassword(secret, acc.secretHash)) {
      throw new UnauthorizedException('设备登录凭据无效');
    }
    const grps = await this.groups.groupsOfClient(acc.id);
    const token = await this.jwt.signAsync({
      sub: clientId,
      clientId,
      role: 'client',
      groups: grps.map((g) => g.id),
      groupNames: grps.map((g) => g.name),
    });
    const base =
      this.cfg.app.publicWsUrl ?? `ws://127.0.0.1:${this.cfg.app.port}`;
    return {
      token,
      wsUrl: `${base}/api/client/ws?token=${token}`,
      clientId,
      groups: grps.map((g) => g.name),
    };
  }
}
