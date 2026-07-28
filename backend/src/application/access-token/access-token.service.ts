import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { desc, eq, ilike, SQL, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { containsPattern } from '../../common/db/like-pattern';
import { pageBounds } from '../../common/db/page-bounds';
import { alive, softDelete } from '../../common/db/soft-delete';
import { QueryTokensDto } from '../../common/dto/query-tokens.dto';
import { DbService } from '../../infrastructure/db/db.service';
import { accessTokenCacheKey } from '../../infrastructure/redis/cache-keys';
import { RedisCacheAsideService } from '../../infrastructure/redis/redis-cache-aside.service';
import { projects } from '../projects/projects.schema';
import { ProjectsService } from '../projects/projects.service';
import { accessTokenProjects, accessTokens } from './access-token.schema';

interface AccessTokenUpdateInput {
  projects?: string[];
  expiresAt?: Date | null;
  maximumUsageCount?: number | null;
}

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly dbService: DbService,
    private readonly projects: ProjectsService,
    private readonly redisCacheAsideService: RedisCacheAsideService,
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
    maximumUsageCount?: number;
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
          maximumUsageCount: input.maximumUsageCount,
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

  async update(accessTokenId: number, input: AccessTokenUpdateInput) {
    const projectSelection = input.projects
      ? await this.resolveProjectSelection(input.projects)
      : undefined;
    const updatesPolicy =
      input.expiresAt !== undefined || input.maximumUsageCount !== undefined;
    if (!projectSelection && !updatesPolicy) {
      throw new BadRequestException('至少提供一个可修改字段');
    }

    const accessTokenRecord =
      await this.redisCacheAsideService.writeAndInvalidate(
        () =>
          this.database.transaction(async (transaction) => {
            const [existingTokenRecord] = await transaction
              .select()
              .from(accessTokens)
              .where(alive(accessTokens, eq(accessTokens.id, accessTokenId)))
              .limit(1);
            if (!existingTokenRecord) {
              throw new NotFoundException('Token 不存在');
            }

            const updatedTokenRecord = updatesPolicy
              ? await this.updatePolicyInTransaction(
                  transaction,
                  accessTokenId,
                  input,
                )
              : existingTokenRecord;
            if (projectSelection) {
              await this.replaceProjectsInTransaction(
                transaction,
                accessTokenId,
                projectSelection.projectIds,
              );
            }
            return updatedTokenRecord;
          }),
        (tokenRecord) => accessTokenCacheKey(tokenRecord.token),
      );

    const projectNames =
      projectSelection?.projectNames ??
      (await this.projectNamesOf(accessTokenId));
    return { ...accessTokenRecord, projects: projectNames };
  }

  async updateProjects(accessTokenId: number, projectsInput: string[]) {
    return this.update(accessTokenId, { projects: projectsInput });
  }

  /**
   * 列表:服务端筛选 + 分页,只装载当前页令牌的 project 名。
   * project 名由 ProjectsService.namesByTokenIds 一次批量装载(固定 3 次查询,与 token 数无关)。
   * 按 id 倒序保证翻页稳定。
   */
  async list(query: QueryTokensDto = {}) {
    const whereClause = alive(accessTokens, ...this.buildConditions(query));
    const { page, pageSize, offset } = pageBounds(query);
    const tokenRecords = await this.database
      .select()
      .from(accessTokens)
      .where(whereClause)
      .orderBy(desc(accessTokens.id))
      .limit(pageSize)
      .offset(offset);
    const [{ total }] = await this.database
      .select({ total: sql<number>`count(*)::int` })
      .from(accessTokens)
      .where(whereClause);

    const projectNamesByTokenId = await this.projects.namesByTokenIds(
      accessTokenProjects,
      tokenRecords.map((tokenRecord) => tokenRecord.id),
    );

    const rows = tokenRecords.map((tokenRecord) => ({
      ...tokenRecord,
      projects: projectNamesByTokenId.get(tokenRecord.id) ?? [],
    }));
    return { rows, page, pageSize, total };
  }

  private buildConditions(query: QueryTokensDto): SQL[] {
    const conditions: SQL[] = [];
    if (query.id !== undefined) {
      conditions.push(eq(accessTokens.id, query.id));
    }
    if (query.name) {
      conditions.push(ilike(accessTokens.name, containsPattern(query.name)));
    }
    if (query.status) {
      conditions.push(eq(accessTokens.status, query.status));
    }
    if (query.project) {
      conditions.push(
        this.projects.hasProjectNameMatch(
          accessTokenProjects,
          accessTokens.id,
          query.project,
        ),
      );
    }
    return conditions;
  }

  /**
   * 撤销 token:更新 status='revoked',并同步删 redis 正缓存
   * (guard 侧对已验证过的 token 会缓存 60s,若不主动删,撤销后仍可再用满 60s)
   */
  async revoke(accessTokenId: number) {
    return this.redisCacheAsideService.writeAndInvalidate(
      async () => {
        const [accessTokenRecord] = await this.database
          .update(accessTokens)
          .set({ status: 'revoked' })
          .where(eq(accessTokens.id, accessTokenId))
          .returning();
        if (!accessTokenRecord) {
          throw new NotFoundException('Token 不存在');
        }
        return accessTokenRecord;
      },
      (accessTokenRecord) => accessTokenCacheKey(accessTokenRecord.token),
    );
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
      maximumUsageCount: accessTokenRecord.maximumUsageCount,
      usageCount: accessTokenRecord.usageCount,
      projectIds: projectRows.map((projectRecord) => projectRecord.projectId),
    };
  }

  async consumeInvocation(accessTokenId: number): Promise<number | null> {
    const accessTokenRecord =
      await this.redisCacheAsideService.writeAndInvalidate(
        async () => {
          const [consumedTokenRecord] = await this.database
            .update(accessTokens)
            .set({ usageCount: sql`${accessTokens.usageCount} + 1` })
            .where(
              alive(
                accessTokens,
                eq(accessTokens.id, accessTokenId),
                eq(accessTokens.status, 'active'),
                sql`${accessTokens.maximumUsageCount} IS NOT NULL`,
                sql`${accessTokens.usageCount} < ${accessTokens.maximumUsageCount}`,
                sql`(${accessTokens.expiresAt} IS NULL OR ${accessTokens.expiresAt} > NOW())`,
              ),
            )
            .returning();
          if (consumedTokenRecord) {
            return consumedTokenRecord;
          }
          return this.resolveUnconsumedToken(accessTokenId);
        },
        (tokenRecord) => accessTokenCacheKey(tokenRecord.token),
      );
    return accessTokenRecord.maximumUsageCount === null
      ? null
      : accessTokenRecord.usageCount;
  }

  /**
   * 软删 token(与 revoke 正交:revoke 改 status,delete 走软删)。
   * 同步删 redis 正缓存,确保已删 token 立即失效(findByToken 会因 alive() 过滤返回 null → guard 401)。
   */
  async delete(accessTokenId: number) {
    await this.redisCacheAsideService.writeAndInvalidate(
      async () => {
        const deletedTokens = await softDelete(
          this.database,
          accessTokens,
          eq(accessTokens.id, accessTokenId),
        );
        const deletedToken = deletedTokens[0] as { token: string } | undefined;
        if (!deletedToken) {
          throw new NotFoundException('Token 不存在');
        }
        return deletedToken;
      },
      (deletedToken) => accessTokenCacheKey(deletedToken.token),
    );
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

  private async projectNamesOf(accessTokenId: number): Promise<string[]> {
    const projectRecords = await this.database
      .select({ name: projects.name })
      .from(accessTokenProjects)
      .innerJoin(
        projects,
        alive(projects, eq(accessTokenProjects.projectId, projects.id)),
      )
      .where(eq(accessTokenProjects.tokenId, accessTokenId));
    return projectRecords.map((projectRecord) => projectRecord.name);
  }

  private async updatePolicyInTransaction(
    transaction: Parameters<Parameters<typeof this.database.transaction>[0]>[0],
    accessTokenId: number,
    input: AccessTokenUpdateInput,
  ) {
    const [updatedTokenRecord] = await transaction
      .update(accessTokens)
      .set({
        expiresAt: input.expiresAt,
        maximumUsageCount: input.maximumUsageCount,
      })
      .where(alive(accessTokens, eq(accessTokens.id, accessTokenId)))
      .returning();
    if (!updatedTokenRecord) {
      throw new NotFoundException('Token 不存在');
    }
    return updatedTokenRecord;
  }

  private async replaceProjectsInTransaction(
    transaction: Parameters<Parameters<typeof this.database.transaction>[0]>[0],
    accessTokenId: number,
    projectIds: number[],
  ): Promise<void> {
    await transaction
      .delete(accessTokenProjects)
      .where(eq(accessTokenProjects.tokenId, accessTokenId));
    await transaction.insert(accessTokenProjects).values(
      projectIds.map((projectId) => ({
        tokenId: accessTokenId,
        projectId,
      })),
    );
  }

  private async resolveUnconsumedToken(accessTokenId: number) {
    const [accessTokenRecord] = await this.database
      .select()
      .from(accessTokens)
      .where(alive(accessTokens, eq(accessTokens.id, accessTokenId)))
      .limit(1);
    if (!accessTokenRecord) {
      throw new UnauthorizedException('无效 token');
    }
    if (accessTokenRecord.status !== 'active') {
      throw new ForbiddenException('token 已停用/撤销');
    }
    if (
      accessTokenRecord.expiresAt &&
      accessTokenRecord.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('token 已过期');
    }
    if (
      accessTokenRecord.maximumUsageCount !== null &&
      accessTokenRecord.usageCount >= accessTokenRecord.maximumUsageCount
    ) {
      throw new HttpException(
        'token 调用次数已用尽',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return accessTokenRecord;
  }
}
