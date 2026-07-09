import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// 在线镜像 TTL(秒);手机端心跳刷新
const PRESENCE_TTL = 30;
const MAX_IN_FLIGHT_DEFAULT = 512;
const MAX_IN_FLIGHT_MIN = 256;
const MAX_IN_FLIGHT_MAX = 1024;
// 原子占槽:INCR 后若超上限同一脚本内 DECR 回退,防非原子两步在 redis 抖动时半失败泄漏(照 ConnectionRegistry 的内联 CAS 脚本)
const ACQUIRE_SLOT_LUA = `local n = redis.call('incr', KEYS[1]); if n > tonumber(ARGV[1]) then redis.call('decr', KEYS[1]); return 0 else return 1 end`;

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
    await this.r.del(`device:maxinflight:${clientId}`);
    await this.r.del(`device:inflight:${clientId}`);
    for (const gid of projectIds) {
      await this.r.srem(`project:clients:${gid}`, clientId);
    }
  }

  // 夹取自报值到 [256,1024];缺省(?maxInFlight 缺失 → null/''）或非数 → 512
  clampMaxInFlight(raw: unknown): number {
    if (raw === null || raw === undefined || raw === '') {
      return MAX_IN_FLIGHT_DEFAULT;
    }
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return MAX_IN_FLIGHT_DEFAULT;
    return Math.min(MAX_IN_FLIGHT_MAX, Math.max(MAX_IN_FLIGHT_MIN, n));
  }

  // 写/刷设备 maxInFlight(TTL 随 presence)
  async setMaxInFlight(clientId: string, max: number) {
    await this.r.set(
      `device:maxinflight:${clientId}`,
      String(max),
      'EX',
      PRESENCE_TTL,
    );
  }
  async getMaxInFlight(clientId: string): Promise<number> {
    const v = await this.r.get(`device:maxinflight:${clientId}`);
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : MAX_IN_FLIGHT_DEFAULT;
  }

  // 连接时清在途计数(限泄漏在一次 session 内)
  async resetInFlight(clientId: string) {
    await this.r.del(`device:inflight:${clientId}`);
  }
  // 占一个在途槽(原子 Lua:INCR + 超限同脚本 DECR 回退,不会半失败泄漏)。满则返 false
  async tryAcquireSlot(clientId: string, max: number): Promise<boolean> {
    const r = (await this.r.eval(
      ACQUIRE_SLOT_LUA,
      1,
      `device:inflight:${clientId}`,
      String(max),
    )) as number;
    return r === 1;
  }
  // 释放一个在途槽(兜底不为负)
  async releaseSlot(clientId: string) {
    const n = await this.r.decr(`device:inflight:${clientId}`);
    if (n < 0) await this.r.set(`device:inflight:${clientId}`, '0');
  }

  async isOnline(clientId: string) {
    return (await this.r.exists(`presence:${clientId}`)) === 1;
  }

  // project 内轮询,占第一个未满设备的在途槽(边挑边占):从 RR 游标起轮一圈,
  // 占到即返 { clientId }(该设备槽已占,调用方 dispatch 后须 releaseSlot);
  // 整圈都满返 'saturated';无在线返 'no_device'。顺带清理 presence 已过期的陈旧集合成员(listOnline 内)。
  async pickOnlineAcquire(
    projectId: number,
  ): Promise<{ clientId: string } | 'no_device' | 'saturated'> {
    const online = await this.listOnline(projectId);
    if (!online.length) return 'no_device';
    online.sort();
    const start = (await this.r.incr(`rpc:rr:${projectId}`)) % online.length;
    for (let i = 0; i < online.length; i++) {
      const clientId = online[(start + i) % online.length];
      const max = await this.getMaxInFlight(clientId);
      if (await this.tryAcquireSlot(clientId, max)) {
        return { clientId };
      }
    }
    return 'saturated';
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
