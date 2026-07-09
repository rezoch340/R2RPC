import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { devices } from '../devices/devices.schema';
import { projects } from '../projects/projects.schema';
import { ProjectsService } from '../projects/projects.service';
import { deviceTokenProjects, deviceTokens } from './device-token.schema';

const WS_TOKEN_POSITIVE_TTL = 60; // 秒
const WS_TOKEN_NEGATIVE_TTL = 10; // 秒(负缓存,防伪造 token 打 DB)

type CachedDeviceToken = {
  id: number;
  status: string;
  expiresAt: Date | string | null;
  projectIds: number[];
};

@Injectable()
export class DeviceTokenService {
  constructor(
    private readonly dbService: DbService,
    private readonly projects: ProjectsService,
    private readonly redis: RedisService,
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
    await this.delWsCache(row.token);
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
    const row = rows[0] as { token?: string };
    if (row.token) await this.delWsCache(row.token);
    return { deleted: true };
  }

  private wsCacheKey(plain: string) {
    return `ws:devtoken:${createHash('sha256').update(plain).digest('hex')}`;
  }

  // DB 查:明文 token → 记录 + projectIds(供 WS 校验回落)
  async findByToken(plain: string): Promise<CachedDeviceToken | null> {
    const [row] = await this.db
      .select()
      .from(deviceTokens)
      .where(alive(deviceTokens, eq(deviceTokens.token, plain)))
      .limit(1);
    if (!row) return null;
    const projectRows = await this.db
      .select({ projectId: deviceTokenProjects.projectId })
      .from(deviceTokenProjects)
      .where(eq(deviceTokenProjects.tokenId, row.id));
    return {
      id: row.id,
      status: row.status,
      expiresAt: row.expiresAt,
      projectIds: projectRows.map((r) => r.projectId),
    };
  }

  // WS 连接校验(cache-aside,fail-open):有效返回 {tokenId, projectIds},失败返回 null
  async validateForConnect(
    plain: string,
  ): Promise<{ tokenId: number; projectIds: number[] } | null> {
    const key = this.wsCacheKey(plain);
    let t = await this.readCache(key);
    if (t === undefined) {
      t = await this.findByToken(plain);
      await this.writeCache(key, t);
    }
    if (!t) return null;
    if (t.status !== 'active') return null;
    if (t.expiresAt && new Date(t.expiresAt) < new Date()) return null;
    return { tokenId: t.id, projectIds: t.projectIds };
  }

  // 命中正缓存→记录;命中负缓存→null;未命中/redis 异常→undefined(回落 DB)
  private async readCache(
    key: string,
  ): Promise<CachedDeviceToken | null | undefined> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as {
        notFound?: boolean;
      } & Partial<CachedDeviceToken>;
      if (parsed.notFound) return null;
      return parsed as CachedDeviceToken;
    } catch {
      return undefined;
    }
  }

  private async writeCache(
    key: string,
    t: CachedDeviceToken | null,
  ): Promise<void> {
    try {
      if (t === null) {
        await this.redis.client.set(
          key,
          JSON.stringify({ notFound: true }),
          'EX',
          WS_TOKEN_NEGATIVE_TTL,
        );
      } else {
        await this.redis.client.set(
          key,
          JSON.stringify(t),
          'EX',
          WS_TOKEN_POSITIVE_TTL,
        );
      }
    } catch {
      // fail-open:缓存写失败不影响校验
    }
  }

  private async delWsCache(plain: string): Promise<void> {
    try {
      await this.redis.client.del(this.wsCacheKey(plain));
    } catch {
      // fail-open:缓存删失败不阻断撤销/删除,最长 TTL 后自然过期
    }
  }
}
