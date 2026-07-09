import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// 在线镜像 TTL(秒);手机端心跳刷新
const PRESENCE_TTL = 30;

// 设备在线状态(redis 镜像,多 project)。权威成员关系仍在 PG(client_groups);这里只做在线状态与 project 内选设备。
// 注意:presence 是软镜像,不做锁;哪个实例持有该 socket 由 ConnectionRegistry 管(client:session),这里不重复维护。
@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}
  private get r() {
    return this.redis.client;
  }

  // 上线:登记到所属每个 project 的在线集合 + 写 presence 快照(JSON projectIds)
  async online(clientId: string, projectIds: number[]) {
    await this.r.set(
      `presence:${clientId}`,
      JSON.stringify(projectIds),
      'EX',
      PRESENCE_TTL,
    );
    for (const gid of projectIds) {
      await this.r.sadd(`project:clients:${gid}`, clientId);
    }
  }

  // 心跳刷新在线 TTL
  async refresh(clientId: string) {
    await this.r.expire(`presence:${clientId}`, PRESENCE_TTL);
  }

  async offline(clientId: string, projectIds: number[]) {
    await this.r.del(`presence:${clientId}`);
    for (const gid of projectIds) {
      await this.r.srem(`project:clients:${gid}`, clientId);
    }
  }

  async isOnline(clientId: string) {
    return (await this.r.exists(`presence:${clientId}`)) === 1;
  }

  // project 内轮询选一个在线设备(顺带清理 presence 已过期的陈旧集合成员)
  async pickOnline(projectId: number): Promise<string | null> {
    const online = await this.listOnline(projectId);
    if (!online.length) return null;
    online.sort();
    const idx = (await this.r.incr(`rpc:rr:${projectId}`)) % online.length;
    return online[idx];
  }

  async listOnline(projectId: number): Promise<string[]> {
    const members = await this.r.smembers(`project:clients:${projectId}`);
    const online: string[] = [];
    for (const c of members) {
      if (await this.isOnline(c)) online.push(c);
      else await this.r.srem(`project:clients:${projectId}`, c);
    }
    return online;
  }
}
