import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { devices } from '../devices/devices.schema';
import { projects } from '../projects/projects.schema';
import { ProjectsService } from '../projects/projects.service';
import { deviceTokenProjects, deviceTokens } from './device-token.schema';

@Injectable()
export class DeviceTokenService {
  constructor(
    private readonly dbService: DbService,
    private readonly projects: ProjectsService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 创建 DeviceToken:去重 project 名 -> 验证存在 -> 事务插 deviceTokens + deviceTokenProjects
   * -> 返回 token 行 + 明文 + project 名。token 前缀 dk_(区别于 access token 的 rk_)。
   */
  async create(input: {
    name: string;
    projects: string[];
    expiresAt?: Date;
    description?: string;
    createdBy?: number;
  }) {
    const projectNames = [...new Set(input.projects)];

    const projectIds: number[] = [];
    for (const projectName of projectNames) {
      const gid = await this.projects.idByName(projectName);
      if (gid === null) {
        throw new BadRequestException(`功能组不存在: ${projectName}`);
      }
      projectIds.push(gid);
    }

    const token = 'dk_' + randomBytes(24).toString('base64url');

    const result = await this.db.transaction(async (tx) => {
      const [tokenRow] = await tx
        .insert(deviceTokens)
        .values({
          name: input.name,
          token,
          expiresAt: input.expiresAt,
          description: input.description,
          createdBy: input.createdBy,
        })
        .returning();

      for (const projectId of projectIds) {
        await tx
          .insert(deviceTokenProjects)
          .values({ tokenId: tokenRow.id, projectId });
      }

      return tokenRow;
    });

    return { ...result, token, projects: projectNames };
  }

  /**
   * 列表:所有 token + project 名 + 在线设备数(count devices where device_token_id=? and online, alive)。
   */
  async list() {
    const tokens = await this.db
      .select()
      .from(deviceTokens)
      .where(alive(deviceTokens));

    return Promise.all(
      tokens.map(async (t) => {
        const projectNames = await this.db
          .select({ name: projects.name })
          .from(deviceTokenProjects)
          .innerJoin(
            projects,
            alive(projects, eq(deviceTokenProjects.projectId, projects.id)),
          )
          .where(eq(deviceTokenProjects.tokenId, t.id));

        const [{ n }] = await this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(devices)
          .where(
            alive(
              devices,
              and(eq(devices.deviceTokenId, t.id), eq(devices.online, true)),
            ),
          );

        return {
          ...t,
          projects: projectNames.map((g) => g.name),
          onlineDeviceCount: n,
        };
      }),
    );
  }

  /** 撤销:status='revoked'。 */
  async revoke(id: number) {
    const [row] = await this.db
      .update(deviceTokens)
      .set({ status: 'revoked' })
      .where(eq(deviceTokens.id, id))
      .returning();
    if (!row) throw new NotFoundException('Device token 不存在');
    // ponytail: 2c 给 device-token 加 WS 校验缓存后,这里必须同步删该 token 的 redis 缓存(照 AccessTokenService.revoke)
    return row;
  }

  /** 软删(与 revoke 正交)。 */
  async delete(id: number) {
    const rows = await softDelete(
      this.db,
      deviceTokens,
      eq(deviceTokens.id, id),
    );
    if (rows.length === 0) throw new NotFoundException('Device token 不存在');
    // ponytail: 2c 加缓存后,这里同步删 redis 缓存(照 AccessTokenService.delete)
    return { deleted: true };
  }
}
