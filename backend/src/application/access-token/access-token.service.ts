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

  private get database() {
    return this.dbService.database;
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
    const { projectNames, projectIds } = await this.resolveProjectSelection(
      input.projects,
    );

    // 生成 token(明文可回看,per 设计)
    const token = 'rk_' + randomBytes(24).toString('base64url');

    // 事务:插 accessTokens + accessTokenProjects
    const result = await this.database.transaction(async (transaction) => {
      // 插 accessTokens,返回完整行
      const insertResult = await transaction
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
        await transaction.insert(accessTokenProjects).values({
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

  async updateProjects(accessTokenId: number, projectsInput: string[]) {
    const { projectNames, projectIds } =
      await this.resolveProjectSelection(projectsInput);
    const accessTokenRecord = await this.database.transaction(
      async (transaction) => {
        const [tokenRecord] = await transaction
          .select()
          .from(accessTokens)
          .where(alive(accessTokens, eq(accessTokens.id, accessTokenId)))
          .limit(1);
        if (!tokenRecord) {
          throw new NotFoundException('Token 不存在');
        }

        await transaction
          .delete(accessTokenProjects)
          .where(eq(accessTokenProjects.tokenId, accessTokenId));
        await transaction.insert(accessTokenProjects).values(
          projectIds.map((projectId) => ({
            tokenId: accessTokenId,
            projectId,
          })),
        );
        return tokenRecord;
      },
    );

    await this.deleteAccessTokenCache(accessTokenRecord.token);
    return { ...accessTokenRecord, projects: projectNames };
  }

  /**
   * 列表:所有 token + 其 project 名(join accessTokenProjects→projects)
   */
  async list() {
    // ponytail: 简单 select + 内存 join;若列表超大,可建数据库 view
    const tokenRecords = await this.database
      .select()
      .from(accessTokens)
      .where(alive(accessTokens));

    // 为每个 token 查其 project 名
    const result = await Promise.all(
      tokenRecords.map(async (tokenRecord) => {
        const projectNames = await this.database
          .select({ name: projects.name })
          .from(accessTokenProjects)
          // 软删 project 不进展示的 project 名列表(读到已删)
          .innerJoin(
            projects,
            alive(projects, eq(accessTokenProjects.projectId, projects.id)),
          )
          .where(eq(accessTokenProjects.tokenId, tokenRecord.id));
        return {
          ...tokenRecord,
          projects: projectNames.map((projectRecord) => projectRecord.name),
        };
      }),
    );

    return result;
  }

  /**
   * 撤销 token:更新 status='revoked',并同步删 redis 正缓存
   * (guard 侧对已验证过的 token 会缓存 60s,若不主动删,撤销后仍可再用满 60s)
   */
  async revoke(accessTokenId: number) {
    const result = await this.database
      .update(accessTokens)
      .set({ status: 'revoked' })
      .where(eq(accessTokens.id, accessTokenId))
      .returning();

    if (result.length === 0) {
      throw new NotFoundException('Token 不存在');
    }

    const accessTokenRecord = result[0];
    if (accessTokenRecord?.token) {
      await this.deleteAccessTokenCache(accessTokenRecord.token);
    }

    return accessTokenRecord;
  }

  /**
   * 按 token 查:热路径查询,供 guard 用
   * 返回 { id, name, status, expiresAt, projectIds }
   */
  async findByToken(token: string) {
    const [accessTokenRecord] = await this.database
      .select()
      .from(accessTokens)
      .where(alive(accessTokens, eq(accessTokens.token, token)))
      .limit(1);

    if (!accessTokenRecord) {
      return null;
    }

    // 查该 token 的所有 projectIds
    const projectRows = await this.database
      .select({ projectId: accessTokenProjects.projectId })
      .from(accessTokenProjects)
      .where(eq(accessTokenProjects.tokenId, accessTokenRecord.id));

    return {
      id: accessTokenRecord.id,
      name: accessTokenRecord.name,
      status: accessTokenRecord.status,
      expiresAt: accessTokenRecord.expiresAt,
      projectIds: projectRows.map((projectRecord) => projectRecord.projectId),
    };
  }

  /**
   * 软删 token(与 revoke 正交:revoke 改 status,delete 走软删)。
   * 同步删 redis 正缓存,确保已删 token 立即失效(findByToken 会因 alive() 过滤返回 null → guard 401)。
   */
  async delete(accessTokenId: number) {
    const deletedTokens = await softDelete(
      this.database,
      accessTokens,
      eq(accessTokens.id, accessTokenId),
    );
    if (deletedTokens.length === 0) {
      throw new NotFoundException('Token 不存在');
    }
    const accessTokenRecord = deletedTokens[0] as { token?: string };
    if (accessTokenRecord.token) {
      await this.deleteAccessTokenCache(accessTokenRecord.token);
    }
    return { deleted: true };
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

  private async deleteAccessTokenCache(plaintextToken: string): Promise<void> {
    const cacheKey = `invoke:token:${createHash('sha256').update(plaintextToken).digest('hex')}`;
    try {
      await this.redis.client.del(cacheKey);
    } catch {
      // fail-open:缓存删失败不阻断写操作,最长 60s 后自然过期
    }
  }
}
