import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// 在线镜像 TTL(秒);手机端心跳刷新
const PRESENCE_TIME_TO_LIVE_SECONDS = 30;
const DEFAULT_IN_FLIGHT_CAPACITY = 16;
const MINIMUM_IN_FLIGHT_CAPACITY = 1;
const MAXIMUM_IN_FLIGHT_CAPACITY = 1024;
// 原子占槽:INCR 后若超上限同一脚本内 DECR 回退,防非原子两步在 redis 抖动时半失败泄漏(照 ConnectionRegistry 的内联 CAS 脚本)
const ACQUIRE_SLOT_LUA = `local n = redis.call('incr', KEYS[1]); if n > tonumber(ARGV[1]) then redis.call('decr', KEYS[1]); return 0 else return 1 end`;

// 设备在线状态(redis 镜像,多 project)。权威成员关系仍在 PG(client_groups);这里只做在线状态与 project 内选设备。
// 注意:presence 是软镜像,不做锁;哪个实例持有该 socket 由 ConnectionRegistry 管(client:session),这里不重复维护。
@Injectable()
export class PresenceService {
  constructor(private readonly redisService: RedisService) {}
  private get redisClient() {
    return this.redisService.client;
  }

  // 上线:登记到所属每个 project 的在线集合 + 写 presence 快照(JSON projectIds)
  async online(clientId: string, projectIds: number[]) {
    await this.redisClient.set(
      `presence:${clientId}`,
      JSON.stringify(projectIds),
      'EX',
      PRESENCE_TIME_TO_LIVE_SECONDS,
    );
    for (const projectId of projectIds) {
      await this.redisClient.sadd(`project:clients:${projectId}`, clientId);
    }
  }

  // 心跳刷新在线 TTL
  async refresh(clientId: string) {
    await this.redisClient.expire(
      `presence:${clientId}`,
      PRESENCE_TIME_TO_LIVE_SECONDS,
    );
  }

  async offline(clientId: string, projectIds: number[]) {
    await this.redisClient.del(`presence:${clientId}`);
    await this.redisClient.del(`device:maxinflight:${clientId}`);
    await this.redisClient.del(`device:inflight:${clientId}`);
    for (const projectId of projectIds) {
      await this.redisClient.srem(`project:clients:${projectId}`, clientId);
    }
  }

  // 尊重设备声明的正整数容量；缺失、非法或非正数使用保守默认值，只限制异常高值。
  clampMaxInFlight(reportedMaximum: unknown): number {
    if (
      reportedMaximum === null ||
      reportedMaximum === undefined ||
      reportedMaximum === ''
    ) {
      return DEFAULT_IN_FLIGHT_CAPACITY;
    }
    const normalizedMaximum = Number(reportedMaximum);
    if (
      !Number.isInteger(normalizedMaximum) ||
      normalizedMaximum < MINIMUM_IN_FLIGHT_CAPACITY
    ) {
      return DEFAULT_IN_FLIGHT_CAPACITY;
    }
    return Math.min(MAXIMUM_IN_FLIGHT_CAPACITY, normalizedMaximum);
  }

  // 写/刷设备 maxInFlight(TTL 随 presence)
  async setMaxInFlight(clientId: string, maximumInFlight: number) {
    await this.redisClient.set(
      `device:maxinflight:${clientId}`,
      String(maximumInFlight),
      'EX',
      PRESENCE_TIME_TO_LIVE_SECONDS,
    );
  }
  async getMaxInFlight(clientId: string): Promise<number> {
    const storedMaximum = await this.redisClient.get(
      `device:maxinflight:${clientId}`,
    );
    return this.clampMaxInFlight(storedMaximum);
  }

  // 连接时清在途计数(限泄漏在一次 session 内)
  async resetInFlight(clientId: string) {
    await this.redisClient.del(`device:inflight:${clientId}`);
  }
  // 占一个在途槽(原子 Lua:INCR + 超限同脚本 DECR 回退,不会半失败泄漏)。满则返 false
  async tryAcquireSlot(
    clientId: string,
    maximumInFlight: number,
  ): Promise<boolean> {
    const acquireResult = (await this.redisClient.eval(
      ACQUIRE_SLOT_LUA,
      1,
      `device:inflight:${clientId}`,
      String(maximumInFlight),
    )) as number;
    return acquireResult === 1;
  }
  // 释放一个在途槽(兜底不为负)
  async releaseSlot(clientId: string) {
    const remainingInFlight = await this.redisClient.decr(
      `device:inflight:${clientId}`,
    );
    if (remainingInFlight < 0) {
      await this.redisClient.set(`device:inflight:${clientId}`, '0');
    }
  }

  async isOnline(clientId: string) {
    return (await this.redisClient.exists(`presence:${clientId}`)) === 1;
  }

  // project 内轮询,占第一个未满设备的在途槽(边挑边占):从 RR 游标起轮一圈,
  // 占到即返 { clientId }(该设备槽已占,调用方 dispatch 后须 releaseSlot);
  // 整圈都满返 'saturated';无在线返 'no_device'。顺带清理 presence 已过期的陈旧集合成员(listOnline 内)。
  async pickOnlineAcquire(
    projectId: number,
  ): Promise<{ clientId: string } | 'no_device' | 'saturated'> {
    const onlineClientIds = await this.listOnline(projectId);
    if (!onlineClientIds.length) {
      return 'no_device';
    }
    onlineClientIds.sort();
    const startingIndex =
      (await this.redisClient.incr(`rpc:rr:${projectId}`)) %
      onlineClientIds.length;
    for (let offset = 0; offset < onlineClientIds.length; offset += 1) {
      const clientId =
        onlineClientIds[(startingIndex + offset) % onlineClientIds.length];
      const maximumInFlight = await this.getMaxInFlight(clientId);
      if (await this.tryAcquireSlot(clientId, maximumInFlight)) {
        return { clientId };
      }
    }
    return 'saturated';
  }

  async listOnline(projectId: number): Promise<string[]> {
    const candidateClientIds = await this.redisClient.smembers(
      `project:clients:${projectId}`,
    );
    const onlineClientIds: string[] = [];
    for (const clientId of candidateClientIds) {
      if (await this.isOnline(clientId)) {
        onlineClientIds.push(clientId);
        continue;
      }
      await this.redisClient.srem(`project:clients:${projectId}`, clientId);
    }
    return onlineClientIds;
  }
}
