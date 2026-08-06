import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, exists, inArray, max, SQL, sql } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { compactConditions, likeIf } from '../../common/db/filter-conditions';
import { paginate } from '../../common/db/paginate';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { devices } from '../devices/devices.schema';
import {
  deviceTokenProjects,
  deviceTokens,
} from '../device-token/device-token.schema';
import { MetricsService } from '../metrics/metrics.service';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { projects } from './projects.schema';

const SEVEN_DAYS_IN_MILLISECONDS = 7 * 86_400_000;

// 令牌—功能组关联表的最小约束。两类令牌的关联表结构一致(token_id/project_id),
// 故 namesByTokenIds 可同时服务 access token 与 device token。
type TokenProjectsTable = PgTable & { tokenId: PgColumn; projectId: PgColumn };

function deriveProjectStatus(input: {
  enabled: boolean;
  totalDevices: number;
  onlineDevices: number;
  lastSeenAt: Date | null;
  currentTime: number;
}) {
  if (!input.enabled) {
    return 'disabled';
  }
  if (input.totalDevices === 0) {
    return 'no_device';
  }
  if (input.onlineDevices > 0) {
    return 'online';
  }
  if (
    input.lastSeenAt &&
    input.currentTime - input.lastSeenAt.getTime() > SEVEN_DAYS_IN_MILLISECONDS
  ) {
    return 'stale';
  }
  return 'offline';
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dbService: DbService,
    private readonly metricsService: MetricsService,
  ) {}
  private get database() {
    return this.dbService.database;
  }

  async list() {
    // 显式排序:没有 ORDER BY 时任何一次 UPDATE 都会改变返回顺序,让下拉选项跳位
    return this.database
      .select()
      .from(projects)
      .where(alive(projects))
      .orderBy(projects.id);
  }

  /**
   * 批量装载「令牌 → 功能组名」:一次查询取回全部令牌的功能组名,再按 tokenId 内存分组。
   * 令牌列表接口逐条查库会退化成 N+1,两类令牌统一走这里。
   * 软删的功能组由 inner join alive 排除,与单令牌读口径一致;按名称排序保证列表输出稳定。
   */
  async namesByTokenIds(
    tokenProjectsTable: TokenProjectsTable,
    tokenIds: number[],
  ): Promise<Map<number, string[]>> {
    const projectNamesByTokenId = new Map<number, string[]>();
    if (tokenIds.length === 0) {
      return projectNamesByTokenId;
    }

    const relationRecords = await this.database
      .select({
        // 结构化列类型拿不到 number 静态类型,用 sql<number> 标注(int4 由 pg 驱动返回 JS number)
        tokenId: sql<number>`${tokenProjectsTable.tokenId}`,
        projectName: projects.name,
      })
      .from(tokenProjectsTable)
      .innerJoin(
        projects,
        alive(projects, eq(tokenProjectsTable.projectId, projects.id)),
      )
      .where(inArray(tokenProjectsTable.tokenId, tokenIds))
      .orderBy(projects.name);

    for (const relationRecord of relationRecords) {
      const projectNames =
        projectNamesByTokenId.get(relationRecord.tokenId) ?? [];
      projectNames.push(relationRecord.projectName);
      projectNamesByTokenId.set(relationRecord.tokenId, projectNames);
    }
    return projectNamesByTokenId;
  }

  /**
   * 「令牌挂了这个功能组」条件,供两类令牌列表按功能组筛选。
   * 功能组名取自下拉选项,是完整名称,故用等值而不是模糊匹配。
   * 用 EXISTS 而不是 join:主查询行数不会因令牌挂多个功能组而翻倍,分页与 count 都不需要去重。
   */
  hasProjectNameMatch(
    tokenProjectsTable: TokenProjectsTable,
    tokenIdColumn: PgColumn,
    projectName: string,
  ): SQL {
    return exists(
      this.database
        .select({ matched: sql`1` })
        .from(tokenProjectsTable)
        .innerJoin(
          projects,
          alive(projects, eq(tokenProjectsTable.projectId, projects.id)),
        )
        .where(
          and(
            eq(tokenProjectsTable.tokenId, tokenIdColumn),
            eq(projects.name, projectName),
          ),
        ),
    );
  }

  async findByName(name: string) {
    const [projectRecord] = await this.database
      .select()
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return projectRecord ?? null;
  }

  async create(name: string, description?: string) {
    if (await this.findByName(name)) {
      throw new ConflictException('功能组已存在');
    }
    const [createdProject] = await this.database
      .insert(projects)
      .values({ name, description })
      .returning();
    return createdProject;
  }

  async remove(projectId: number) {
    await softDelete(this.database, projects, eq(projects.id, projectId));
    return { deleted: true };
  }

  // 按名查 id(不存在返回 null),供设备登录/建组解析 project 名用
  async idByName(name: string) {
    const [project] = await this.database
      .select({ id: projects.id })
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return project?.id ?? null;
  }

  // 供 invoke 派发:一把查出 id + enabled(alive)
  async findEnabledIdByName(name: string) {
    const [projectRecord] = await this.database
      .select({ id: projects.id, enabled: projects.enabled })
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return projectRecord ?? null;
  }

  // 启停(alive)
  async setEnabled(projectId: number, enabled: boolean) {
    const [updatedProject] = await this.database
      .update(projects)
      .set({ enabled })
      .where(alive(projects, eq(projects.id, projectId)))
      .returning({
        id: projects.id,
        name: projects.name,
        enabled: projects.enabled,
      });
    if (!updatedProject) {
      throw new NotFoundException('功能组不存在');
    }
    return updatedProject;
  }

  // 每 project 派生统计(设备数/在线数/近7天/成功率/lastSeen + 运行态)
  /**
   * 列表页数据源:只返回库里存在的基础字段,服务端筛选 + 分页。
   * 设备聚合、近 7 天指标和运行态都是派生值,进不了 WHERE,拆到 statsByIds 单独取,
   * 由列表页拿到当页 id 后二次请求——一条带 CASE 的大 SQL 换两次简单查询。
   */
  async listPaged(query: QueryProjectsDto = {}) {
    const whereClause = alive(projects, ...this.buildListConditions(query));
    return paginate(
      this.database,
      projects,
      whereClause,
      query,
      (limit, offset) =>
        this.database
          .select({
            id: projects.id,
            name: projects.name,
            description: projects.description,
            enabled: projects.enabled,
          })
          .from(projects)
          .where(whereClause)
          .orderBy(projects.id)
          .limit(limit)
          .offset(offset),
    );
  }

  private buildListConditions(query: QueryProjectsDto): SQL[] {
    return compactConditions(
      likeIf(projects.name, query.name),
      query.enabled ? eq(projects.enabled, query.enabled === 'enabled') : null,
    );
  }

  /**
   * 派生统计:设备数、在线数、最后在线、近 7 天请求与成功率、运行态。
   * 只算传入的这几个功能组——列表页每页 10 行,聚合范围随之从全表缩到 10 行。
   */
  async statsByIds(projectIds: number[]) {
    if (projectIds.length === 0) {
      return [];
    }
    const projectRecords = await this.database
      .select({
        id: projects.id,
        name: projects.name,
        enabled: projects.enabled,
      })
      .from(projects)
      .where(alive(projects, inArray(projects.id, projectIds)));

    // 设备计数:devices → device_tokens → device_token_projects,按 project_id 汇总(alive 设备)
    const deviceSummaryRows = await this.database
      .select({
        projectId: deviceTokenProjects.projectId,
        total: count(),
        online: sql<number>`count(*) filter (where ${devices.online})::int`,
        lastSeen: max(devices.lastSeenAt),
      })
      .from(devices)
      .innerJoin(
        deviceTokens,
        alive(deviceTokens, eq(devices.deviceTokenId, deviceTokens.id)),
      )
      .innerJoin(
        deviceTokenProjects,
        eq(deviceTokens.id, deviceTokenProjects.tokenId),
      )
      .where(alive(devices, inArray(deviceTokenProjects.projectId, projectIds)))
      .groupBy(deviceTokenProjects.projectId);
    const deviceSummaryByProject = new Map(
      deviceSummaryRows.map((deviceSummary) => [
        deviceSummary.projectId,
        deviceSummary,
      ]),
    );

    const requestMetricsByProject =
      await this.metricsService.requests7dByProject();

    const currentTime = Date.now();
    return projectRecords.map((project) => {
      const { totalDevices, onlineDevices, lastSeenAt } =
        this.normalizeDeviceSummary(deviceSummaryByProject.get(project.id));
      const { requests7d, success7d } = this.normalizeRequestMetrics(
        requestMetricsByProject.get(project.name),
      );
      return {
        projectId: project.id,
        totalDevices,
        onlineDevices,
        lastSeenAt,
        requests7d,
        success7d,
        successRate: this.successRate(success7d, requests7d),
        status: deriveProjectStatus({
          enabled: project.enabled,
          totalDevices,
          onlineDevices,
          lastSeenAt,
          currentTime,
        }),
      };
    });
  }

  /** 仪表盘计数:功能组总数与启用数,一条查询,不走列表接口。 */
  async summary() {
    const [summaryRow] = await this.database
      .select({
        total: sql<number>`count(*)::int`,
        enabled: sql<number>`count(*) filter (where ${projects.enabled})::int`,
      })
      .from(projects)
      .where(alive(projects));
    return { total: summaryRow?.total ?? 0, enabled: summaryRow?.enabled ?? 0 };
  }

  private normalizeDeviceSummary(
    deviceSummary:
      | {
          total: number;
          online: number;
          lastSeen: Date | null;
        }
      | undefined,
  ) {
    if (!deviceSummary) {
      return { totalDevices: 0, onlineDevices: 0, lastSeenAt: null };
    }
    return {
      totalDevices: Number(deviceSummary.total),
      onlineDevices: Number(deviceSummary.online),
      lastSeenAt: deviceSummary.lastSeen,
    };
  }

  private normalizeRequestMetrics(
    requestMetrics:
      | {
          requests7d: number;
          success7d: number;
        }
      | undefined,
  ) {
    if (!requestMetrics) {
      return { requests7d: 0, success7d: 0 };
    }
    return {
      requests7d: Number(requestMetrics.requests7d),
      success7d: Number(requestMetrics.success7d),
    };
  }

  private successRate(successfulRequests: number, totalRequests: number) {
    if (totalRequests === 0) {
      return 0;
    }
    return Math.round((successfulRequests * 10_000) / totalRequests) / 100;
  }
}
