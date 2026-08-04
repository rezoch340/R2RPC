import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, SQL, sql } from 'drizzle-orm';
import { containsPattern } from '../../common/db/like-pattern';
import { pageBounds } from '../../common/db/page-bounds';
import { alive } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { devices } from './devices.schema';
import { QueryDevicesDto } from './dto/query-devices.dto';

interface DeviceMeta {
  platform?: string | null;
  lastIp?: string | null;
  extra?: string | null;
  maxInFlight?: number | null;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly dbService: DbService,
    private readonly redis: RedisService,
  ) {}
  private get database() {
    return this.dbService.database;
  }

  // 设备上线:按 client_id upsert;置 online/status=online + 捕获 platform/ip/extra
  async registerOnline(
    clientId: string,
    deviceTokenId: number,
    metadata: DeviceMeta = {},
  ): Promise<void> {
    // lastIp 每次连接都刷(反映当前网络);platform/extra 是"安装态"元数据,本次缺省则保留旧值不覆盖
    const base = {
      deviceTokenId,
      online: true,
      status: 'online',
      lastIp: metadata.lastIp ?? null,
      maxInFlight: metadata.maxInFlight ?? null,
      lastSeenAt: new Date(),
    };
    // 不过滤 alive:设备闲置超期会被软删,重连必须复用原行(回滚软删)而不是插新行。
    // 活行优先、其次取最新软删行——历史遗留可能存在多条软删行,且活行在时绝不复活
    // 另一行,否则撞 client_id 的 partial unique。
    const [existing] = await this.database
      .select({ id: devices.id, deletedAt: devices.deletedAt })
      .from(devices)
      .where(eq(devices.clientId, clientId))
      .orderBy(sql`${devices.deletedAt} IS NOT NULL`, desc(devices.id))
      .limit(1);
    if (existing) {
      const patch = {
        ...base,
        ...(existing.deletedAt ? { deletedAt: null } : {}),
        ...(metadata.platform != null ? { platform: metadata.platform } : {}),
        ...(metadata.extra != null ? { extra: metadata.extra } : {}),
      };
      await this.database
        .update(devices)
        .set(patch)
        .where(eq(devices.id, existing.id));
    } else {
      await this.database.insert(devices).values({
        clientId,
        ...base,
        platform: metadata.platform ?? null,
        extra: metadata.extra ?? null,
      });
    }
  }

  // 优雅下线:online=false + status=offline
  async markOffline(clientId: string): Promise<void> {
    await this.database
      .update(devices)
      .set({ online: false, status: 'offline' })
      .where(alive(devices, eq(devices.clientId, clientId)));
  }

  // stale 对账:PG online=true 但 Redis presence 已过期(设备实际掉线)→ 置 offline/stale。返回置 stale 条数。
  // 顺带刷新本轮确认仍在线设备的 lastSeenAt,让「最后在线」反映真实活跃时间而非上次连接时刻。
  // ponytail: 逐设备 EXISTS,设备量大再改 pipeline。presence 键约定同 PresenceService(presence:{clientId})。
  async markStaleOffline(): Promise<number> {
    const onlineDevices = await this.database
      .select({ id: devices.id, clientId: devices.clientId })
      .from(devices)
      .where(alive(devices, eq(devices.online, true)));
    let staleDeviceCount = 0;
    const presentDeviceIds: number[] = [];
    for (const device of onlineDevices) {
      const present = await this.redis.client.exists(
        `presence:${device.clientId}`,
      );
      if (present !== 0) {
        presentDeviceIds.push(device.id);
        continue;
      }
      // 仍带 online=true 守卫:若期间设备已优雅下线(online 翻 false),本次写成 no-op,不把 offline 误标 stale
      const updateResult = await this.database
        .update(devices)
        .set({ online: false, status: 'stale' })
        .where(
          alive(
            devices,
            and(eq(devices.id, device.id), eq(devices.online, true)),
          ),
        );
      if ((updateResult.rowCount ?? 0) > 0) {
        staleDeviceCount += 1;
      }
    }
    await this.refreshLastSeen(presentDeviceIds);
    return staleDeviceCount;
  }

  // 闲置清扫:连续 idleDays 天没再上线的设备软删。返回软删条数。
  // online=false 是谓词语义的一部分——标着在线的设备按定义就不是闲置;它同时兜住
  // lastSeenAt 刷新链路中断(Worker 停摆/调度丢失)时误删在线设备。
  // lastSeenAt 为 NULL 时比较结果为 NULL,行自然不匹配,无需额外分支。
  async softDeleteIdle(idleDays: number): Promise<number> {
    const deleteResult = await this.database
      .update(devices)
      .set({ deletedAt: new Date() })
      .where(
        alive(
          devices,
          and(
            eq(devices.online, false),
            sql`${devices.lastSeenAt} < now() - make_interval(days => ${idleDays})`,
          ),
        ),
      );
    return deleteResult.rowCount ?? 0;
  }

  // 批量刷新仍在线设备的 lastSeenAt。WS 心跳每 10s 一次且落在 API 热路径,不能每次写库,
  // 因此「最后在线」按对账周期(60s)更新——精度对展示足够,且不拖慢 invoke。
  private async refreshLastSeen(deviceIds: number[]): Promise<void> {
    if (deviceIds.length === 0) {
      return;
    }
    await this.database
      .update(devices)
      .set({ lastSeenAt: new Date() })
      .where(alive(devices, inArray(devices.id, deviceIds)));
  }

  // 列表:alive 设备按 id 倒序(新设备在前),筛选与分页都在服务端执行,不整表返回
  async list(query: QueryDevicesDto = {}) {
    const whereClause = alive(devices, ...this.buildConditions(query));
    const { page, pageSize, offset } = pageBounds(query);
    const rows = await this.database
      .select()
      .from(devices)
      .where(whereClause)
      .orderBy(desc(devices.id))
      .limit(pageSize)
      .offset(offset);
    const [{ total }] = await this.database
      .select({ total: sql<number>`count(*)::int` })
      .from(devices)
      .where(whereClause);
    return { rows, page, pageSize, total };
  }

  private buildConditions(query: QueryDevicesDto): SQL[] {
    const conditions: SQL[] = [];
    if (query.clientId) {
      conditions.push(ilike(devices.clientId, containsPattern(query.clientId)));
    }
    if (query.platform) {
      conditions.push(ilike(devices.platform, containsPattern(query.platform)));
    }
    if (query.lastIp) {
      conditions.push(ilike(devices.lastIp, containsPattern(query.lastIp)));
    }
    if (query.status) {
      conditions.push(eq(devices.status, query.status));
    }
    return conditions;
  }

  // 详情:单台(alive),不存在返回 null
  async get(deviceId: number) {
    const [deviceRecord] = await this.database
      .select()
      .from(devices)
      .where(alive(devices, eq(devices.id, deviceId)))
      .limit(1);
    return deviceRecord ?? null;
  }
}
