import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';

interface Waiter {
  clientId: string;
  resolve: (result: unknown) => void;
  timer: NodeJS.Timeout;
}

// 本进程持有的 socket 与在等 result 的 waiter。单实例内热路径直连。
// ponytail: 单进程内存注册表;多实例需把 job 下发 + result 回传接到 redis pub/sub。
@Injectable()
export class ConnectionRegistry {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly inflight = new Map<string, number>();

  register(clientId: string, socket: WebSocket) {
    this.sockets.set(clientId, socket);
  }

  unregister(clientId: string) {
    this.sockets.delete(clientId);
  }

  hasLocal(clientId: string) {
    return this.sockets.has(clientId);
  }

  inflightCount(clientId: string) {
    return this.inflight.get(clientId) ?? 0;
  }

  // 下发 job 到本进程持有的 socket;返回是否成功(socket 不在本实例或未打开则 false)
  sendJob(clientId: string, job: unknown): boolean {
    const s = this.sockets.get(clientId);
    if (!s || s.readyState !== 1) return false;
    s.send(JSON.stringify(job));
    return true;
  }

  // 等待某 requestId 的 result;超时 reject。expectedClientId 用于校验 result 来源。
  waitForResult<T = unknown>(
    requestId: string,
    expectedClientId: string,
    timeoutMs: number,
  ): Promise<T> {
    this.inflight.set(expectedClientId, this.inflightCount(expectedClientId) + 1);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        this.decInflight(expectedClientId);
        reject(new Error('timeout'));
      }, timeoutMs);
      this.waiters.set(requestId, {
        clientId: expectedClientId,
        resolve: resolve as (r: unknown) => void,
        timer,
      });
    });
  }

  // 收到 result:解对应 waiter。迟到/重复(无 waiter)与 clientId 不匹配都在这里挡掉。
  resolveResult(
    requestId: string,
    fromClientId: string,
    result: unknown,
  ): 'ok' | 'late' | 'mismatch' {
    const w = this.waiters.get(requestId);
    if (!w) return 'late';
    if (w.clientId !== fromClientId) return 'mismatch';
    clearTimeout(w.timer);
    this.waiters.delete(requestId);
    this.decInflight(w.clientId);
    w.resolve(result);
    return 'ok';
  }

  private decInflight(clientId: string) {
    const n = this.inflightCount(clientId) - 1;
    if (n <= 0) this.inflight.delete(clientId);
    else this.inflight.set(clientId, n);
  }
}
