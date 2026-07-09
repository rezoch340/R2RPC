import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, count, eq, max, sql } from 'drizzle-orm';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { devices } from '../devices/devices.schema';
import {
  deviceTokenProjects,
  deviceTokens,
} from '../device-token/device-token.schema';
import { MetricsService } from '../metrics/metrics.service';
import { projects } from './projects.schema';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dbService: DbService,
    private readonly metrics: MetricsService,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  async list() {
    return this.db.select().from(projects).where(alive(projects));
  }

  async findByName(name: string) {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return row ?? null;
  }

  async create(name: string) {
    if (await this.findByName(name)) {
      throw new ConflictException('功能组已存在');
    }
    const [row] = await this.db.insert(projects).values({ name }).returning();
    return row;
  }

  async remove(id: number) {
    await softDelete(this.db, projects, eq(projects.id, id));
    return { deleted: true };
  }

  // 按名查 id(不存在返回 null),供设备登录/建组解析 project 名用
  async idByName(name: string) {
    const [g] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return g?.id ?? null;
  }

  // 供 invoke 派发:一把查出 id + enabled(alive)
  async findEnabledIdByName(name: string) {
    const [row] = await this.db
      .select({ id: projects.id, enabled: projects.enabled })
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return row ?? null;
  }

  // 启停(alive)
  async setEnabled(id: number, enabled: boolean) {
    const [row] = await this.db
      .update(projects)
      .set({ enabled })
      .where(alive(projects, eq(projects.id, id)))
      .returning({
        id: projects.id,
        name: projects.name,
        enabled: projects.enabled,
      });
    if (!row) throw new NotFoundException('功能组不存在');
    return row;
  }

  // 每 project 派生统计(设备数/在线数/近7天/成功率/lastSeen + 运行态)
  async groupInfo() {
    const projs = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        enabled: projects.enabled,
      })
      .from(projects)
      .where(alive(projects))
      .orderBy(projects.id);

    // 设备计数:devices → device_tokens → device_token_projects,按 project_id 汇总(alive 设备)
    const devRows = await this.db
      .select({
        projectId: deviceTokenProjects.projectId,
        total: count(),
        online: sql<number>`count(*) filter (where ${devices.online})::int`,
        lastSeen: max(devices.lastSeenAt),
      })
      .from(devices)
      .innerJoin(deviceTokens, eq(devices.deviceTokenId, deviceTokens.id))
      .innerJoin(
        deviceTokenProjects,
        eq(deviceTokens.id, deviceTokenProjects.tokenId),
      )
      .where(alive(devices))
      .groupBy(deviceTokenProjects.projectId);
    const devByProject = new Map(devRows.map((r) => [r.projectId, r]));

    const m7d = await this.metrics.requests7dByProject();

    const now = Date.now();
    const SEVEN_DAYS = 7 * 86_400_000;
    return projs.map((p) => {
      const d = devByProject.get(p.id);
      const total = Number(d?.total ?? 0);
      const online = Number(d?.online ?? 0);
      const lastSeenAt = d?.lastSeen ?? null;
      const met = m7d.get(p.name);
      const requests7d = Number(met?.requests7d ?? 0);
      const success7d = Number(met?.success7d ?? 0);
      const status = !p.enabled
        ? 'disabled'
        : total === 0
          ? 'no_device'
          : online > 0
            ? 'online'
            : lastSeenAt && now - new Date(lastSeenAt).getTime() > SEVEN_DAYS
              ? 'stale'
              : 'offline';
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        enabled: p.enabled,
        totalDevices: total,
        onlineDevices: online,
        lastSeenAt,
        requests7d,
        success7d,
        successRate: requests7d
          ? Math.round((success7d * 10000) / requests7d) / 100
          : 0,
        status,
      };
    });
  }
}
