import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { alive } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { devices } from './devices.schema';

interface DeviceMeta {
  platform?: string | null;
  lastIp?: string | null;
  extra?: string | null;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly dbService: DbService,
    private readonly redis: RedisService,
  ) {}
  private get db() {
    return this.dbService.db;
  }

  // 设备上线:按 client_id upsert;置 online/status=online + 捕获 platform/ip/extra
  async registerOnline(
    clientId: string,
    deviceTokenId: number,
    meta: DeviceMeta = {},
  ): Promise<void> {
    const fields = {
      deviceTokenId,
      online: true,
      status: 'online',
      platform: meta.platform ?? null,
      lastIp: meta.lastIp ?? null,
      extra: meta.extra ?? null,
      lastSeenAt: new Date(),
    };
    const [existing] = await this.db
      .select({ id: devices.id })
      .from(devices)
      .where(alive(devices, eq(devices.clientId, clientId)))
      .limit(1);
    if (existing) {
      await this.db
        .update(devices)
        .set(fields)
        .where(eq(devices.id, existing.id));
    } else {
      await this.db.insert(devices).values({ clientId, ...fields });
    }
  }

  // 优雅下线:online=false + status=offline
  async markOffline(clientId: string): Promise<void> {
    await this.db
      .update(devices)
      .set({ online: false, status: 'offline' })
      .where(alive(devices, eq(devices.clientId, clientId)));
  }

  // stale 对账:PG online=true 但 Redis presence 已过期(设备实际掉线)→ 置 offline/stale。返回置 stale 条数。
  // ponytail: 逐设备 EXISTS,设备量大再改 pipeline。presence 键约定同 PresenceService(presence:{clientId})。
  async markStaleOffline(): Promise<number> {
    const rows = await this.db
      .select({ id: devices.id, clientId: devices.clientId })
      .from(devices)
      .where(alive(devices, eq(devices.online, true)));
    let stale = 0;
    for (const d of rows) {
      const present = await this.redis.client.exists(`presence:${d.clientId}`);
      if (present === 0) {
        await this.db
          .update(devices)
          .set({ online: false, status: 'stale' })
          .where(eq(devices.id, d.id));
        stale++;
      }
    }
    return stale;
  }

  // 列表:所有 alive 设备(按 id 倒序)
  async list() {
    return this.db
      .select()
      .from(devices)
      .where(alive(devices))
      .orderBy(devices.id);
  }

  // 详情:单台(alive),不存在返回 null
  async get(id: number) {
    const [row] = await this.db
      .select()
      .from(devices)
      .where(alive(devices, eq(devices.id, id)))
      .limit(1);
    return row ?? null;
  }
}
