import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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
    void this.bus.subscribe(`rpc:result:${INSTANCE_ID}`, (m: { requestId: string; result: any }) =>
      this.resolveLocalWaiter(m.requestId, m.result));
  }

  // ── socket 生命周期(gateway 调) ──
  async register(clientId: string, socket: WebSocket) {
    this.sockets.set(clientId, socket);
    await this.r.set(`client:session:${clientId}`, INSTANCE_ID, 'EX', SESSION_TTL);
  }
  async refreshSession(clientId: string) {
    await this.r.expire(`client:session:${clientId}`, SESSION_TTL);
  }
  async unregister(clientId: string) {
    this.sockets.delete(clientId);
    await this.r.del(`client:session:${clientId}`);
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
    const holder = await this.r.get(`client:session:${clientId}`);
    if (!holder) return false; // 设备已掉线(session 过期/未注册)
    if (holder === INSTANCE_ID) return this.deliverLocalJob(clientId, job);
    await this.bus.publish(`ws:send:${holder}`, { clientId, job });
    return true; // 已投递到持有实例,不代表送达 socket(持有实例上的 socket 若已掉线,只会静默丢弃——由 waiter 超时兜底)
  }

  // 注册等待 + 记录本实例为等待方(必须在 dispatchJob 前调用,防止 result 早于 waiter 到达)
  async waitForResult<T = unknown>(
    requestId: string,
    expectedClientId: string,
    timeoutMs: number,
  ): Promise<T> {
    await this.r.set(`rpc:waiter:${requestId}`, INSTANCE_ID, 'PX', timeoutMs + 5000);
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
  async handleResult(
    requestId: string,
    fromClientId: string,
    result: unknown,
  ): Promise<'ok' | 'late' | 'routed' | 'mismatch'> {
    const first = await this.r.set(`rpc:completed:${requestId}`, '1', 'EX', COMPLETED_TTL, 'NX');
    if (first !== 'OK') return 'late'; // 迟到/重复(已有实例处理过,原子 NX 判首个)
    const waiterInstance = await this.r.get(`rpc:waiter:${requestId}`);
    if (!waiterInstance) return 'late'; // 已超时,无人等
    if (waiterInstance === INSTANCE_ID) {
      return this.resolveLocalWaiter(requestId, result) ? 'ok' : 'mismatch';
    }
    await this.bus.publish(`rpc:result:${waiterInstance}`, { requestId, result });
    return 'routed';
  }

  // 解本地 waiter;校验 result.clientId 与预期一致(clientId 不匹配挡掉)
  private resolveLocalWaiter(requestId: string, result: any): boolean {
    const w = this.waiters.get(requestId);
    if (!w) return false;
    if (result?.clientId && w.clientId && result.clientId !== w.clientId) return false; // mismatch
    clearTimeout(w.timer);
    this.waiters.delete(requestId);
    w.resolve(result);
    return true;
  }
}
