import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  DEVICE_TOKEN_SCOPE_CHANGED_CHANNEL,
  type DeviceTokenScopeChangedEvent,
} from '../../common/constants/device-token-events';
import { RedisService } from '../redis/redis.service';
import { ClusterBus } from './cluster-bus.service';
import { INSTANCE_IDENTIFIER } from './instance-id';

// 连接上挂的每连接会话 token(CAS 删除用),避免 (socket as any)
type SessionSocket = WebSocket & {
  _sessionToken?: string;
  _deviceTokenId?: number;
};

interface Waiter {
  clientId: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const SESSION_TIME_TO_LIVE_SECONDS = 30; // client:session 秒(心跳刷新)
const COMPLETED_TIME_TO_LIVE_SECONDS = 60; // rpc:completed 秒(跨实例去重窗口)

// 判定本连接是否仍是该会话的 owner:值等于本连接 token 则删并认领;
// 键不存在(TTL 到期,无人接手)同样认领——此时没有更新的会话会被误伤,
// 而漏认领会让 handleDisconnect 整个跳过下线清理,把正确性押给 60s 的 stale 对账。
// 只有键存在但属于别的连接/实例时才不认领(避免误删已迁移的会话)。
// ponytail: 直接 eval 内联脚本,单一调用点不值得 defineCommand;第二个 CAS 场景出现时再抽
const COMPARE_AND_DELETE_SCRIPT = `local value = redis.call('get', KEYS[1]); if value == false then return 1 elseif value == ARGV[1] then redis.call('del', KEYS[1]); return 1 else return 0 end`;

// 本实例持有的 socket + 在等的 waiter;跨实例路由/去重走 Redis + ClusterBus。
// 分布式:本地 Map 只放本实例状态,权威协调在 Redis(client:session / rpc:waiter / rpc:completed)。
@Injectable()
export class ConnectionRegistry implements OnModuleInit {
  private readonly logger = new Logger('ConnRegistry');
  private readonly sockets = new Map<string, WebSocket>();
  private readonly waiters = new Map<string, Waiter>();

  constructor(
    private readonly clusterBus: ClusterBus,
    private readonly redisService: RedisService,
  ) {}
  private get redisClient() {
    return this.redisService.client;
  }

  onModuleInit() {
    // 订阅本实例两条通道:别的实例把 job 投过来 / 把 result 投过来
    void this.clusterBus.subscribe(
      `ws:send:${INSTANCE_IDENTIFIER}`,
      (message: { clientId: string; job: unknown }) => {
        this.deliverLocalJob(message.clientId, message.job);
      },
    );
    void this.clusterBus.subscribe(
      `rpc:result:${INSTANCE_IDENTIFIER}`,
      async (message: {
        requestId: string;
        result: unknown;
        fromClientId: string;
      }) => {
        const resolved = this.resolveLocalWaiter(
          message.requestId,
          message.result,
          message.fromClientId,
        );
        if (!resolved) {
          await this.redisClient.del(`rpc:completed:${message.requestId}`);
        }
      },
    );
    void this.clusterBus.subscribe(
      DEVICE_TOKEN_SCOPE_CHANGED_CHANNEL,
      (event: DeviceTokenScopeChangedEvent) => {
        this.disconnectLocalDeviceTokenSessions(event.deviceTokenId);
      },
    );
  }

  // ── socket 生命周期(gateway 调) ──
  async register(clientId: string, socket: WebSocket) {
    // 每次连接生成唯一 token,存到 socket 上;client:session 值带实例前缀,供 CAS 判断
    const sessionToken = `${INSTANCE_IDENTIFIER}:${randomUUID()}`;
    (socket as SessionSocket)._sessionToken = sessionToken;
    this.sockets.set(clientId, socket);
    await this.redisClient.set(
      `client:session:${clientId}`,
      sessionToken,
      'EX',
      SESSION_TIME_TO_LIVE_SECONDS,
    );
  }
  async refreshSession(clientId: string) {
    await this.redisClient.expire(
      `client:session:${clientId}`,
      SESSION_TIME_TO_LIVE_SECONDS,
    );
  }
  // 返回本连接是否仍是该 clientId 的 owner(CAS 删除成功)。旧连接延迟触发的 disconnect
  // 若已被更新的注册覆盖,token 不匹配,不会误删新会话,也不该跑下线清理。
  async unregister(clientId: string, socket: WebSocket): Promise<boolean> {
    if (this.sockets.get(clientId) === socket) {
      this.sockets.delete(clientId);
    }
    const sessionToken = (socket as SessionSocket)._sessionToken;
    if (!sessionToken) {
      return false;
    }
    const deleted = (await this.redisClient.eval(
      COMPARE_AND_DELETE_SCRIPT,
      1,
      `client:session:${clientId}`,
      sessionToken,
    )) as number;
    return deleted === 1;
  }
  hasLocal(clientId: string) {
    return this.sockets.has(clientId);
  }

  private disconnectLocalDeviceTokenSessions(deviceTokenId: number): void {
    for (const socket of this.sockets.values()) {
      const sessionSocket = socket as SessionSocket;
      if (
        sessionSocket._deviceTokenId === deviceTokenId &&
        sessionSocket.readyState === 1
      ) {
        sessionSocket.close(4002, 'device token scope updated');
      }
    }
  }

  private deliverLocalJob(clientId: string, job: unknown): boolean {
    const socket = this.sockets.get(clientId);
    if (!socket || socket.readyState !== 1) {
      return false;
    }
    const deadlineAt = (job as { deadlineAt?: number }).deadlineAt;
    if (deadlineAt && Date.now() > deadlineAt) {
      this.logger.warn(`job 已过 deadline,丢弃: ${clientId}`);
      return false; // 过期不发(即时派发下极少触发;跨实例经 bus 到达时若已过期在此丢弃)
    }
    socket.send(JSON.stringify(job));
    return true;
  }

  // ── invoke 侧(rpc.service 调) ──
  // 把 job 路由到持有该 socket 的实例;返回是否成功送达调度
  async dispatchJob(clientId: string, job: unknown): Promise<boolean> {
    const sessionToken = await this.redisClient.get(
      `client:session:${clientId}`,
    );
    if (!sessionToken) {
      return false;
    }
    const holderInstance = sessionToken.split(':')[0];
    if (holderInstance === INSTANCE_IDENTIFIER) {
      return this.deliverLocalJob(clientId, job);
    }
    await this.clusterBus.publish(`ws:send:${holderInstance}`, {
      clientId,
      job,
    });
    return true; // 已投递到持有实例,不代表送达 socket(持有实例上的 socket 若已掉线,只会静默丢弃——由 waiter 超时兜底)
  }

  // 同步注册本地 waiter(executor 内即 set),返回结果 promise
  registerWaiter<T = unknown>(
    requestId: string,
    expectedClientId: string,
    timeoutMilliseconds: number,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        reject(new Error('timeout'));
      }, timeoutMilliseconds);
      this.waiters.set(requestId, {
        clientId: expectedClientId,
        resolve,
        reject,
        timer,
      });
    });
  }
  // 写 redis 等待方标记(必须在 dispatchJob 前 await 完,防止 result 早于 waiter 到达)
  async markWaiting(requestId: string, timeoutMilliseconds: number) {
    await this.redisClient.set(
      `rpc:waiter:${requestId}`,
      INSTANCE_IDENTIFIER,
      'PX',
      timeoutMilliseconds + 5000,
    );
  }
  // dispatch 失败时清理本地 waiter(避免空等到超时)
  cancelWaiter(requestId: string, reason: string) {
    const waiter = this.waiters.get(requestId);
    if (!waiter) {
      return;
    }
    clearTimeout(waiter.timer);
    this.waiters.delete(requestId);
    waiter.reject(new Error(reason));
  }

  // ── result 侧(gateway 收到 device result 时调) ──
  // 跨实例去重 + 路由到等待实例。返回 outcome 给 resultAck。
  // 顺序:先查有没有等待方,没有就不占 completed slot(防止无人等的迟到结果把 slot 毒化,挡住后续合法结果)。
  async handleResult(
    requestId: string,
    fromClientId: string,
    result: unknown,
  ): Promise<'ok' | 'late' | 'routed' | 'mismatch'> {
    const waiterInstance = await this.redisClient.get(
      `rpc:waiter:${requestId}`,
    );
    if (!waiterInstance) {
      return 'late';
    }
    const firstResult = await this.redisClient.set(
      `rpc:completed:${requestId}`,
      '1',
      'EX',
      COMPLETED_TIME_TO_LIVE_SECONDS,
      'NX',
    );
    if (firstResult !== 'OK') {
      return 'late';
    }
    if (waiterInstance === INSTANCE_IDENTIFIER) {
      const resolved = this.resolveLocalWaiter(requestId, result, fromClientId);
      if (resolved) {
        return 'ok';
      }
      await this.redisClient.del(`rpc:completed:${requestId}`);
      return 'mismatch';
    }
    await this.clusterBus.publish(`rpc:result:${waiterInstance}`, {
      requestId,
      result,
      fromClientId,
    });
    return 'routed';
  }

  // 解本地 waiter;校验鉴权身份(socket 上验过的 fromClientId)与预期一致,不用设备自报的 result.clientId
  private resolveLocalWaiter(
    requestId: string,
    result: unknown,
    fromClientId: string,
  ): boolean {
    const waiter = this.waiters.get(requestId);
    if (!waiter) {
      return false;
    }
    if (waiter.clientId && fromClientId !== waiter.clientId) {
      return false;
    }
    clearTimeout(waiter.timer);
    this.waiters.delete(requestId);
    waiter.resolve(result);
    return true;
  }
}
