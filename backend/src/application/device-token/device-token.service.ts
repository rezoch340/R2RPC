import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  DEVICE_TOKEN_SCOPE_CHANGED_CHANNEL,
  type DeviceTokenScopeChangedEvent,
} from '../../common/constants/device-token-events';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { deviceTokenCacheKey } from '../../infrastructure/redis/cache-keys';
import { RedisCacheAsideService } from '../../infrastructure/redis/redis-cache-aside.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { devices } from '../devices/devices.schema';
import { projects } from '../projects/projects.schema';
import { ProjectsService } from '../projects/projects.service';
import { deviceTokenProjects, deviceTokens } from './device-token.schema';

const WEBSOCKET_TOKEN_POSITIVE_TIME_TO_LIVE_SECONDS = 60;
const WEBSOCKET_TOKEN_NEGATIVE_TIME_TO_LIVE_SECONDS = 10;

type CachedDeviceToken = {
  id: number;
  status: string;
  expiresAt: Date | string | null;
  projectIds: number[];
};
const cachedDeviceTokenSchema = z
  .object({
    id: z.number().int(),
    status: z.string(),
    expiresAt: z.union([z.date(), z.string()]).nullable(),
    projectIds: z.array(z.number().int()),
  })
  .nullable();

@Injectable()
export class DeviceTokenService {
  constructor(
    private readonly dbService: DbService,
    private readonly projects: ProjectsService,
    private readonly redisService: RedisService,
    private readonly redisCacheAsideService: RedisCacheAsideService,
  ) {}

  private get database() {
    return this.dbService.database;
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
    const { projectNames, projectIds } = await this.resolveProjectSelection(
      input.projects,
    );

    const token = 'dk_' + randomBytes(24).toString('base64url');

    const result = await this.database.transaction(async (transaction) => {
      const [tokenRow] = await transaction
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
        await transaction
          .insert(deviceTokenProjects)
          .values({ tokenId: tokenRow.id, projectId });
      }

      return tokenRow;
    });

    return { ...result, token, projects: projectNames };
  }

  async updateProjects(deviceTokenId: number, projectsInput: string[]) {
    const { projectNames, projectIds } =
      await this.resolveProjectSelection(projectsInput);
    const deviceTokenRecord =
      await this.redisCacheAsideService.writeAndInvalidate(
        () =>
          this.database.transaction(async (transaction) => {
            const [tokenRecord] = await transaction
              .select()
              .from(deviceTokens)
              .where(alive(deviceTokens, eq(deviceTokens.id, deviceTokenId)))
              .limit(1);
            if (!tokenRecord) {
              throw new NotFoundException('Device token 不存在');
            }

            await transaction
              .delete(deviceTokenProjects)
              .where(eq(deviceTokenProjects.tokenId, deviceTokenId));
            await transaction.insert(deviceTokenProjects).values(
              projectIds.map((projectId) => ({
                tokenId: deviceTokenId,
                projectId,
              })),
            );
            return tokenRecord;
          }),
        (tokenRecord) => deviceTokenCacheKey(tokenRecord.token),
      );
    await this.notifyScopeChanged(deviceTokenId);
    return { ...deviceTokenRecord, projects: projectNames };
  }

  /**
   * 列表:所有 token + project 名 + 在线设备数(count devices where device_token_id=? and online, alive)。
   */
  async list() {
    const tokenRecords = await this.database
      .select()
      .from(deviceTokens)
      .where(alive(deviceTokens));

    return Promise.all(
      tokenRecords.map(async (tokenRecord) => {
        const projectNames = await this.database
          .select({ name: projects.name })
          .from(deviceTokenProjects)
          .innerJoin(
            projects,
            alive(projects, eq(deviceTokenProjects.projectId, projects.id)),
          )
          .where(eq(deviceTokenProjects.tokenId, tokenRecord.id));

        const [{ onlineDeviceCount }] = await this.database
          .select({ onlineDeviceCount: sql<number>`count(*)::int` })
          .from(devices)
          .where(
            alive(
              devices,
              and(
                eq(devices.deviceTokenId, tokenRecord.id),
                eq(devices.online, true),
              ),
            ),
          );

        return {
          ...tokenRecord,
          projects: projectNames.map((projectRecord) => projectRecord.name),
          onlineDeviceCount,
        };
      }),
    );
  }

  /** 撤销:status='revoked'。 */
  async revoke(deviceTokenId: number) {
    return this.redisCacheAsideService.writeAndInvalidate(
      async () => {
        const [deviceTokenRecord] = await this.database
          .update(deviceTokens)
          .set({ status: 'revoked' })
          .where(eq(deviceTokens.id, deviceTokenId))
          .returning();
        if (!deviceTokenRecord) {
          throw new NotFoundException('Device token 不存在');
        }
        return deviceTokenRecord;
      },
      (deviceTokenRecord) => deviceTokenCacheKey(deviceTokenRecord.token),
    );
  }

  /** 软删(与 revoke 正交)。 */
  async delete(deviceTokenId: number) {
    await this.redisCacheAsideService.writeAndInvalidate(
      async () => {
        const deletedTokens = await softDelete(
          this.database,
          deviceTokens,
          eq(deviceTokens.id, deviceTokenId),
        );
        const deletedToken = deletedTokens[0] as { token: string } | undefined;
        if (!deletedToken) {
          throw new NotFoundException('Device token 不存在');
        }
        return deletedToken;
      },
      (deletedToken) => deviceTokenCacheKey(deletedToken.token),
    );
    return { deleted: true };
  }

  // DB 查:明文 token → 记录 + projectIds(供 WS 校验回落)
  async findByToken(plaintextToken: string): Promise<CachedDeviceToken | null> {
    const [deviceTokenRecord] = await this.database
      .select()
      .from(deviceTokens)
      .where(alive(deviceTokens, eq(deviceTokens.token, plaintextToken)))
      .limit(1);
    if (!deviceTokenRecord) {
      return null;
    }
    const projectRows = await this.database
      .select({ projectId: deviceTokenProjects.projectId })
      .from(deviceTokenProjects)
      .where(eq(deviceTokenProjects.tokenId, deviceTokenRecord.id));
    return {
      id: deviceTokenRecord.id,
      status: deviceTokenRecord.status,
      expiresAt: deviceTokenRecord.expiresAt,
      projectIds: projectRows.map((projectRecord) => projectRecord.projectId),
    };
  }

  // WS 连接校验(cache-aside,fail-open):有效返回 {tokenId, projectIds},失败返回 null
  async validateForConnect(
    plaintextToken: string,
  ): Promise<{ tokenId: number; projectIds: number[] } | null> {
    const cacheKey = deviceTokenCacheKey(plaintextToken);
    const deviceTokenRecord = await this.redisCacheAsideService.getOrLoad(
      cacheKey,
      cachedDeviceTokenSchema,
      () => this.findByToken(plaintextToken),
      (loadedToken) =>
        loadedToken
          ? WEBSOCKET_TOKEN_POSITIVE_TIME_TO_LIVE_SECONDS
          : WEBSOCKET_TOKEN_NEGATIVE_TIME_TO_LIVE_SECONDS,
    );
    if (!deviceTokenRecord) {
      return null;
    }
    if (deviceTokenRecord.status !== 'active') {
      return null;
    }
    if (
      deviceTokenRecord.expiresAt &&
      new Date(deviceTokenRecord.expiresAt) < new Date()
    ) {
      return null;
    }
    return {
      tokenId: deviceTokenRecord.id,
      projectIds: deviceTokenRecord.projectIds,
    };
  }

  private async resolveProjectSelection(projectsInput: string[]) {
    const projectNames = [...new Set(projectsInput)];
    if (projectNames.length === 0) {
      throw new BadRequestException('至少选择一个功能组');
    }

    const projectIds: number[] = [];
    for (const projectName of projectNames) {
      const projectId = await this.projects.idByName(projectName);
      if (projectId === null) {
        throw new BadRequestException(`功能组不存在: ${projectName}`);
      }
      projectIds.push(projectId);
    }
    return { projectNames, projectIds };
  }

  private async notifyScopeChanged(deviceTokenId: number): Promise<void> {
    const event: DeviceTokenScopeChangedEvent = { deviceTokenId };
    try {
      await this.redisService.client.publish(
        DEVICE_TOKEN_SCOPE_CHANGED_CHANNEL,
        JSON.stringify(event),
      );
    } catch {
      // fail-open:数据库作用域已更新;连接最迟在下次重连时获取新作用域
    }
  }
}
