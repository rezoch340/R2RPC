import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { alive } from '../../common/db/soft-delete';
import { hashPassword, verifyPassword } from '../../common/utils/password';
import { ConfigService } from '../../infrastructure/config/config.service';
import { DbService } from '../../infrastructure/db/db.service';
import { ProjectsService } from '../projects/projects.service';
import { clientGroups } from './client-groups.schema';
import { clients } from './client.schema';

@Injectable()
export class ClientService {
  constructor(
    private readonly dbService: DbService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
    private readonly projects: ProjectsService,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  async findByClientId(clientId: string) {
    const [row] = await this.db
      .select()
      .from(clients)
      .where(alive(clients, eq(clients.clientId, clientId)))
      .limit(1);
    return row ?? null;
  }

  // 管理端:创建手机设备账号(secret 存 scrypt 哈希),并按 project 名关联 client_groups
  // project 成员关系是设备权限的唯一来源,不接受客户端自报
  async createAccount(input: {
    clientId: string;
    secret: string;
    projects: string[];
  }) {
    if (await this.findByClientId(input.clientId)) {
      throw new ConflictException('设备账号已存在');
    }

    // Dedupe project names to avoid composite PK violations
    const projectNames = [...new Set(input.projects)];

    // Resolve project IDs before transaction (create projects if needed)
    const projectIds = await Promise.all(
      projectNames.map(async (name) => {
        return (
          (await this.projects.idByName(name)) ??
          (await this.projects.create(name)).id
        );
      }),
    );

    // Wrap client insert + all client_groups inserts in atomic transaction
    const row = await this.db.transaction(async (tx) => {
      const insertResult = await tx
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

      const [client] = insertResult;

      for (const projectId of projectIds) {
        await tx
          .insert(clientGroups)
          .values({ clientId: client.id, groupId: projectId });
      }

      return client;
    });

    return row;
  }

  async list() {
    return this.db
      .select({
        id: clients.id,
        clientId: clients.clientId,
        createdAt: clients.createdAt,
      })
      .from(clients)
      .where(alive(clients));
  }

  // 手机端登录:校验凭据,查设备所属 project(client_groups,来源可信,非客户端自报)→ 签发多 project client JWT + 返回 wsUrl
  async login(clientId: string, secret: string) {
    const acc = await this.findByClientId(clientId);
    if (!acc || !verifyPassword(secret, acc.secretHash)) {
      throw new UnauthorizedException('设备登录凭据无效');
    }
    const projs = await this.projects.projectsOfClient(acc.id);
    const token = await this.jwt.signAsync({
      sub: clientId,
      clientId,
      role: 'client',
      projects: projs.map((g) => g.id),
      projectNames: projs.map((g) => g.name),
    });
    const base =
      this.cfg.app.publicWsUrl ?? `ws://127.0.0.1:${this.cfg.app.port}`;
    return {
      token,
      wsUrl: `${base}/api/client/ws?token=${token}`,
      clientId,
      projects: projs.map((g) => g.name),
    };
  }
}
