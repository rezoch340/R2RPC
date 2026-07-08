import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// 在线镜像 TTL(秒);手机端心跳刷新
const PRESENCE_TTL = 30;

// 设备在线状态(redis 镜像)。权威业务仍在 PG;这里只做在线状态与组内选设备。
@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}
  private get r() {
    return this.redis.client;
  }

  async online(clientId: string, group: string) {
    await this.r.set(`presence:${clientId}`, group, 'EX', PRESENCE_TTL);
    await this.r.sadd(`group:clients:${group}`, clientId);
  }

  // 心跳刷新在线 TTL
  async refresh(clientId: string) {
    await this.r.expire(`presence:${clientId}`, PRESENCE_TTL);
  }

  async offline(clientId: string, group: string) {
    await this.r.del(`presence:${clientId}`);
    await this.r.srem(`group:clients:${group}`, clientId);
  }

  async isOnline(clientId: string) {
    return (await this.r.exists(`presence:${clientId}`)) === 1;
  }

  // 组内轮询选一个在线设备(顺带清理 presence 已过期的陈旧集合成员)
  async pickOnline(group: string): Promise<string | null> {
    const online = await this.listOnline(group);
    if (!online.length) return null;
    online.sort();
    const idx = (await this.r.incr(`rpc:rr:${group}`)) % online.length;
    return online[idx];
  }

  async listOnline(group: string): Promise<string[]> {
    const members = await this.r.smembers(`group:clients:${group}`);
    const online: string[] = [];
    for (const c of members) {
      if (await this.isOnline(c)) online.push(c);
      else await this.r.srem(`group:clients:${group}`, c);
    }
    return online;
  }
}
