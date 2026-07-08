import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { RedisService } from '../redis/redis.service';
import { ClusterBus } from './cluster-bus.service';
import { INSTANCE_ID } from './instance-id';

interface Waiter {
  clientId: string;
  resolve: (r: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

const SESSION_TTL = 30; // client:session 秒(心跳刷新)
const COMPLETED_TTL = 60; // rpc:completed 秒(跨实例去重窗口)

// 仅当 key 值等于本连接 token 才删(避免误删已迁移到别连接/别实例的会话)
// ponytail: 直接 eval 内联脚本,单一调用点不值得 defineCommand;第二个 CAS 场景出现时再抽
const CAS_DEL = `local v = redis.call('get', KEYS[1]); if v == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

// 本实例持有的 socket + 在等的 waiter;跨实例路由/去重走 Redis + ClusterBus。
// 分布式:本地 Map 只放本实例状态,权威协调在 Redis(client:session / rpc:waiter / rpc:completed)。
@Injectable()
export class ConnectionRegistry implements OnModuleInit {
  private readonly logger = new Logger('ConnRegistry');
  private readonly sockets = new Map<string, WebSocket>();
  private readonly waiters = new Map<string, Waiter>();

  constructor(
    private readonly bus: ClusterBus,
    private readonly redis: RedisService,
  ) {}
  private get r() {
    return this.redis.client;
  }

  onModuleInit() {
    // 订阅本实例两条通道:别的实例把 job 投过来 / 把 result 投过来
    void this.bus.subscribe(`ws:send:${INSTANCE_ID}`, (m: { clientId: string; job: unknown }) =>
      this.deliverLocalJob(m.clientId, m.job));
    void this.bus.subscribe(
      `rpc:result:${INSTANCE_ID}`,
      async (m: { requestId: string; result: any; fromClientId: string }) => {
        const ok = this.resolveLocalWaiter(m.requestId, m.result, m.fromClientId);
        if (!ok) await this.r.del(`rpc:completed:${m.requestId}`); // 不匹配 → 释放被占的去重 slot,留给合法结果
      },
    );
  }

  // ── socket 生命周期(gateway 调) ──
  async register(clientId: string, socket: WebSocket) {
    // 每次连接生成唯一 token,存到 socket 上;client:session 值带实例前缀,供 CAS 判断
    const token = `${INSTANCE_ID}:${randomUUID()}`;
    (socket as any)._sessionToken = token;
    this.sockets.set(clientId, socket);
    await this.r.set(`client:session:${clientId}`, token, 'EX', SESSION_TTL);
  }
  async refreshSession(clientId: string) {
    await this.r.expire(`client:session:${clientId}`, SESSION_TTL);
  }
  // 返回本连接是否仍是该 clientId 的 owner(CAS 删除成功)。旧连接延迟触发的 disconnect
  // 若已被更新的注册覆盖,token 不匹配,不会误删新会话,也不该跑下线清理。
  async unregister(clientId: string, socket: WebSocket): Promise<boolean> {
    if (this.sockets.get(clientId) === socket) this.sockets.delete(clientId);
    const token = (socket as any)._sessionToken;
    if (!token) return false;
    const deleted = (await this.r.eval(CAS_DEL, 1, `client:session:${clientId}`, token)) as number;
    return deleted === 1;
  }
  hasLocal(clientId: string) {
    return this.sockets.has(clientId);
  }

  private deliverLocalJob(clientId: string, job: unknown): boolean {
    const s = this.sockets.get(clientId);
    if (!s || s.readyState !== 1) return false;
    s.send(JSON.stringify(job));
    return true;
  }

  // ── invoke 侧(rpc.service 调) ──
  // 把 job 路由到持有该 socket 的实例;返回是否成功送达调度
  async dispatchJob(clientId: string, job: unknown): Promise<boolean> {
    const raw = await this.r.get(`client:session:${clientId}`);
    if (!raw) return false; // 设备已掉线(session 过期/未注册)
    const holder = raw.split(':')[0]; // client:session 值为 "{instanceId}:{nonce}",取实例前缀
    if (holder === INSTANCE_ID) return this.deliverLocalJob(clientId, job);
    await this.bus.publish(`ws:send:${holder}`, { clientId, job });
    return true; // 已投递到持有实例,不代表送达 socket(持有实例上的 socket 若已掉线,只会静默丢弃——由 waiter 超时兜底)
  }

  // 同步注册本地 waiter(executor 内即 set),返回结果 promise
  registerWaiter<T = unknown>(
    requestId: string,
    expectedClientId: string,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        reject(new Error('timeout'));
      }, timeoutMs);
      this.waiters.set(requestId, {
        clientId: expectedClientId,
        resolve: resolve as (r: unknown) => void,
        reject,
        timer,
      });
    });
  }
  // 写 redis 等待方标记(必须在 dispatchJob 前 await 完,防止 result 早于 waiter 到达)
  async markWaiting(requestId: string, timeoutMs: number) {
    await this.r.set(`rpc:waiter:${requestId}`, INSTANCE_ID, 'PX', timeoutMs + 5000);
  }
  // dispatch 失败时清理本地 waiter(避免空等到超时)
  cancelWaiter(requestId: string, reason: string) {
    const w = this.waiters.get(requestId);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.delete(requestId);
    w.reject(new Error(reason));
  }

  // ── result 侧(gateway 收到 device result 时调) ──
  // 跨实例去重 + 路由到等待实例。返回 outcome 给 resultAck。
  // 顺序:先查有没有等待方,没有就不占 completed slot(防止无人等的迟到结果把 slot 毒化,挡住后续合法结果)。
  async handleResult(
    requestId: string,
    fromClientId: string,
    result: unknown,
  ): Promise<'ok' | 'late' | 'routed' | 'mismatch'> {
    const waiterInstance = await this.r.get(`rpc:waiter:${requestId}`);
    if (!waiterInstance) return 'late'; // 无人等,不占 slot
    const first = await this.r.set(`rpc:completed:${requestId}`, '1', 'EX', COMPLETED_TTL, 'NX');
    if (first !== 'OK') return 'late'; // 已被处理(原子 NX 判首个)
    if (waiterInstance === INSTANCE_ID) {
      if (this.resolveLocalWaiter(requestId, result, fromClientId)) return 'ok';
      await this.r.del(`rpc:completed:${requestId}`); // 不匹配 → 释放 slot,留给合法结果
      return 'mismatch';
    }
    await this.bus.publish(`rpc:result:${waiterInstance}`, { requestId, result, fromClientId });
    return 'routed';
  }

  // 解本地 waiter;校验鉴权身份(socket 上验过的 fromClientId)与预期一致,不用设备自报的 result.clientId
  private resolveLocalWaiter(requestId: string, result: unknown, fromClientId: string): boolean {
    const w = this.waiters.get(requestId);
    if (!w) return false;
    if (w.clientId && fromClientId !== w.clientId) return false; // 用鉴权身份判不匹配,不用设备自报字段
    clearTimeout(w.timer);
    this.waiters.delete(requestId);
    w.resolve(result);
    return true;
  }
}
