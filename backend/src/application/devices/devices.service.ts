import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { alive } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { devices } from './devices.schema';

@Injectable()
export class DevicesService {
  constructor(private readonly dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  // 设备上线:按 client_id upsert(revive alive 行 / 新建),记 device_token_id + online + last_seen
  async registerOnline(
    clientId: string,
    deviceTokenId: number,
  ): Promise<void> {
    const [existing] = await this.db
      .select({ id: devices.id })
      .from(devices)
      .where(alive(devices, eq(devices.clientId, clientId)))
      .limit(1);
    if (existing) {
      await this.db
        .update(devices)
        .set({ deviceTokenId, online: true, lastSeenAt: new Date() })
        .where(eq(devices.id, existing.id));
    } else {
      await this.db
        .insert(devices)
        .values({ clientId, deviceTokenId, online: true, lastSeenAt: new Date() });
    }
  }

  // 设备下线:置 online=false(权威冷持久;presence 热镜像由 WS 生命周期另清)
  async markOffline(clientId: string): Promise<void> {
    await this.db
      .update(devices)
      .set({ online: false })
      .where(alive(devices, eq(devices.clientId, clientId)));
  }
}
