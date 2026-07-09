import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { projects } from '../projects/projects.schema';
import { ProjectsService } from '../projects/projects.service';
import { accessTokenProjects, accessTokens } from './access-token.schema';

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly dbService: DbService,
    private readonly projects: ProjectsService,
    private readonly redis: RedisService,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * 创建 AccessToken:
   * - 去重 project 名
   * - 验证 project 存在(idByName)
   * - 事务:插 accessTokens + accessTokenProjects
   * - 返回 token 行 + project 名(供 UI 回显)
   */
  async create(input: {
    name: string;
    projects: string[];
    expiresAt?: Date;
    description?: string;
    createdBy?: number;
  }) {
    // 去重 project 名,避免复合 PK 冲突
    const projectNames = [...new Set(input.projects)];

    // 验证 project 存在,解析 project id
    const projectIds: number[] = [];
    for (const projectName of projectNames) {
      const gid = await this.projects.idByName(projectName);
      if (gid === null) {
        throw new BadRequestException(`功能组不存在: ${projectName}`);
      }
      projectIds.push(gid);
    }

    // 生成 token(明文可回看,per 设计)
    const token = 'rk_' + randomBytes(24).toString('base64url');

    // 事务:插 accessTokens + accessTokenProjects
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

      // 为每个 projectId 插 accessTokenProjects
      for (const projectId of projectIds) {
        await tx.insert(accessTokenProjects).values({
          tokenId: tokenRow.id,
          projectId,
        });
      }

      return tokenRow;
    });

    return {
      ...result,
      token, // 明文 token(plain)
      projects: projectNames, // project 名供回显
    };
  }

  /**
   * 列表:所有 token + 其 project 名(join accessTokenProjects→projects)
   */
  async list() {
    // ponytail: 简单 select + 内存 join;若列表超大,可建数据库 view
    const tokens = await this.db
      .select()
      .from(accessTokens)
      .where(alive(accessTokens));

    // 为每个 token 查其 project 名
    const result = await Promise.all(
      tokens.map(async (t) => {
        const projectNames = await this.db
          .select({ name: projects.name })
          .from(accessTokenProjects)
          // 软删 project 不进展示的 project 名列表(读到已删)
          .innerJoin(
            projects,
            alive(projects, eq(accessTokenProjects.projectId, projects.id)),
          )
          .where(eq(accessTokenProjects.tokenId, t.id));
        return {
          ...t,
          projects: projectNames.map((g) => g.name),
        };
      }),
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
   * 返回 { id, name, status, expiresAt, projectIds }
   */
  async findByToken(token: string) {
    const [row] = await this.db
      .select()
      .from(accessTokens)
      .where(alive(accessTokens, eq(accessTokens.token, token)))
      .limit(1);

    if (!row) {
      return null;
    }

    // 查该 token 的所有 projectIds
    const projectRows = await this.db
      .select({ projectId: accessTokenProjects.projectId })
      .from(accessTokenProjects)
      .where(eq(accessTokenProjects.tokenId, row.id));

    return {
      id: row.id,
      name: row.name,
      status: row.status,
      expiresAt: row.expiresAt,
      projectIds: projectRows.map((gr) => gr.projectId),
    };
  }

  /**
   * 软删 token(与 revoke 正交:revoke 改 status,delete 走软删)。
   * 同步删 redis 正缓存,确保已删 token 立即失效(findByToken 会因 alive() 过滤返回 null → guard 401)。
   */
  async delete(id: number) {
    const rows = await softDelete(
      this.db,
      accessTokens,
      eq(accessTokens.id, id),
    );
    if (rows.length === 0) {
      throw new NotFoundException('Token 不存在');
    }
    const row = rows[0] as { token?: string };
    if (row.token) {
      const key = `invoke:token:${createHash('sha256').update(row.token).digest('hex')}`;
      try {
        await this.redis.client.del(key);
      } catch {
        // fail-open: 缓存删失败不阻断,最长 60s 自然过期
      }
    }
    return { deleted: true };
  }
}
