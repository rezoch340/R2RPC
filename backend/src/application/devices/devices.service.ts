import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { alive } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { devices } from './devices.schema';

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
    const [existing] = await this.database
      .select({ id: devices.id })
      .from(devices)
      .where(alive(devices, eq(devices.clientId, clientId)))
      .limit(1);
    if (existing) {
      const patch = {
        ...base,
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
  // ponytail: 逐设备 EXISTS,设备量大再改 pipeline。presence 键约定同 PresenceService(presence:{clientId})。
  async markStaleOffline(): Promise<number> {
    const onlineDevices = await this.database
      .select({ id: devices.id, clientId: devices.clientId })
      .from(devices)
      .where(alive(devices, eq(devices.online, true)));
    let staleDeviceCount = 0;
    for (const device of onlineDevices) {
      const present = await this.redis.client.exists(
        `presence:${device.clientId}`,
      );
      if (present !== 0) {
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
    return staleDeviceCount;
  }

  // 列表:所有 alive 设备(按 id 倒序,新设备在前)
  async list() {
    return this.database
      .select()
      .from(devices)
      .where(alive(devices))
      .orderBy(desc(devices.id));
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
