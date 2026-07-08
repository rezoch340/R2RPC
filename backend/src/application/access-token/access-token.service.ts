import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { DbService } from '../../infrastructure/db/db.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { groups } from '../groups/groups.schema';
import { GroupsService } from '../groups/groups.service';
import { accessTokenGroups, accessTokens } from './access-token.schema';

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly dbService: DbService,
    private readonly groups: GroupsService,
    private readonly redis: RedisService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 创建 AccessToken:
   * - 去重组名
   * - 验证组存在(idByName)
   * - 事务:插 accessTokens + accessTokenGroups
   * - 返回 token 行 + 组名(供 UI 回显)
   */
  async create(input: {
    name: string;
    groups: string[];
    expiresAt?: Date;
    description?: string;
    createdBy?: number;
  }) {
    // 去重组名,避免复合 PK 冲突
    const groupNames = [...new Set(input.groups)];

    // 验证组存在,解析组 id
    const groupIds: number[] = [];
    for (const groupName of groupNames) {
      const gid = await this.groups.idByName(groupName);
      if (gid === null) {
        throw new BadRequestException(`组不存在: ${groupName}`);
      }
      groupIds.push(gid);
    }

    // 生成 token(明文可回看,per 设计)
    const token = 'rk_' + randomBytes(24).toString('base64url');

    // 事务:插 accessTokens + accessTokenGroups
    const result = await this.db.transaction(async (tx) => {
      // 插 accessTokens,返回完整行
      const insertResult = await tx
        .insert(accessTokens)
        .values({
          name: input.name,
          token,
          expiresAt: input.expiresAt,
          description: input.description,
          createdBy: input.createdBy,
        })
        .returning();

      const [tokenRow] = insertResult;

      // 为每个 groupId 插 accessTokenGroups
      for (const groupId of groupIds) {
        await tx.insert(accessTokenGroups).values({
          tokenId: tokenRow.id,
          groupId,
        });
      }

      return tokenRow;
    });

    return {
      ...result,
      token, // 明文 token(plain)
      groups: groupNames, // 组名供回显
    };
  }

  /**
   * 列表:所有 token + 其组名(join accessTokenGroups→groups)
   */
  async list() {
    // ponytail: 简单 select + 内存 join;若列表超大,可建数据库 view
    const tokens = await this.db.select().from(accessTokens);

    // 为每个 token 查其组名
    const result = await Promise.all(
      tokens.map(async (t) => {
        const groupNames = await this.db
          .select({ name: groups.name })
          .from(accessTokenGroups)
          .innerJoin(groups, eq(accessTokenGroups.groupId, groups.id))
          .where(eq(accessTokenGroups.tokenId, t.id));
        return {
          ...t,
          groups: groupNames.map((g) => g.name),
        };
      })
    );

    return result;
  }

  /**
   * 撤销 token:更新 status='revoked',并同步删 redis 正缓存
   * (guard 侧对已验证过的 token 会缓存 60s,若不主动删,撤销后仍可再用满 60s)
   */
  async revoke(id: number) {
    const result = await this.db
      .update(accessTokens)
      .set({ status: 'revoked' })
      .where(eq(accessTokens.id, id))
      .returning();

    if (result.length === 0) {
      throw new NotFoundException('Token 不存在');
    }

    const row = result[0];
    if (row?.token) {
      // key 格式需与 AccessTokenGuard 完全一致(sha256 摘要明文 token)
      const key = `invoke:token:${createHash('sha256').update(row.token).digest('hex')}`;
      try {
        await this.redis.client.del(key);
      } catch {
        // fail-open: 缓存删失败不阻断撤销,最长 60s 后自然过期
      }
    }

    return row;
  }

  /**
   * 按 token 查:热路径查询,供 guard 用
   * 返回 { id, name, status, expiresAt, groupIds }
   */
  async findByToken(token: string) {
    const [row] = await this.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.token, token))
      .limit(1);

    if (!row) {
      return null;
    }

    // 查该 token 的所有 groupIds
    const groupRows = await this.db
      .select({ groupId: accessTokenGroups.groupId })
      .from(accessTokenGroups)
      .where(eq(accessTokenGroups.tokenId, row.id));

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      expiresAt: row.expiresAt,
      groupIds: groupRows.map((gr) => gr.groupId),
    };
  }
}
