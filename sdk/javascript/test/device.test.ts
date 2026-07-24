import {
  describe,
  expect,
  it as testCase,
  vi as vitest,
} from 'vitest';
import {
  R2RpcDevice,
  type WebSocketFactory,
  type WebSocketLike,
} from '../src/index.js';

class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose:
    | ((event: {
        code: number;
        reason: string;
      }) => void)
    | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sentMessages: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.sentMessages.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  receive(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe('R2RpcDevice', () => {
  testCase('处理真实 Job 并返回 Result', async () => {
    const webSocket = new FakeWebSocket();
    const webSocketFactory: WebSocketFactory = () => webSocket;
    const stateChanges: string[] = [];
    const device = new R2RpcDevice({
      baseUrl: 'http://127.0.0.1:3000',
      deviceToken: 'dk_fixture',
      clientId: 'device-1',
      webSocketFactory,
      heartbeatIntervalMilliseconds: 60_000,
      onStateChange: ({ state }) => stateChanges.push(state),
    });
    device.registerAction('hello', async (job) => ({
      payload: { message: 'hello', received: job.payload },
      status: 'ok',
      isOk: true,
    }));

    device.start();
    webSocket.receive({
      type: 'welcome',
      clientId: 'device-1',
      projects: [1],
      maxInFlight: 512,
    });
    webSocket.receive({
      type: 'job',
      requestId: 'request-1',
      project: 'cn-nodes',
      action: 'hello',
      payload: { message: 'hello' },
      timeoutSeconds: 5,
      deadlineAt: Date.now() + 5000,
    });
    await vitest.waitFor(() => {
      expect(webSocket.sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'result',
          requestId: 'request-1',
          clientId: 'device-1',
          is_ok: true,
          status: 'ok',
        }),
      );
    });
    expect(stateChanges).toEqual(['connecting', 'online']);
    device.stop();
  });

  testCase('没有处理器时返回可诊断错误', async () => {
    const webSocket = new FakeWebSocket();
    const device = new R2RpcDevice({
      baseUrl: 'http://127.0.0.1:3000',
      deviceToken: 'dk_fixture',
      clientId: 'device-1',
      webSocketFactory: () => webSocket,
    });
    device.start();
    webSocket.receive({
      type: 'job',
      requestId: 'request-2',
      project: 'cn-nodes',
      action: 'missing',
      payload: {},
      timeoutSeconds: 5,
    });
    await vitest.waitFor(() => {
      expect(webSocket.sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'result',
          requestId: 'request-2',
          is_ok: false,
          httpCode: 404,
        }),
      );
    });
    device.stop();
  });

  testCase('Action 超时后只返回一次 timeout 结果', async () => {
    vitest.useFakeTimers();
    const webSocket = new FakeWebSocket();
    const device = new R2RpcDevice({
      baseUrl: 'http://127.0.0.1:3000',
      deviceToken: 'dk_fixture',
      clientId: 'device-1',
      webSocketFactory: () => webSocket,
    });
    device.registerAction(
      'slow',
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ payload: { late: true } }), 10_000);
        }),
    );
    device.start();
    webSocket.receive({
      type: 'job',
      requestId: 'request-timeout',
      project: 'cn-nodes',
      action: 'slow',
      payload: {},
      timeoutSeconds: 1,
    });

    await vitest.advanceTimersByTimeAsync(1_000);
    expect(webSocket.sentMessages).toContainEqual(
      expect.objectContaining({
        type: 'result',
        requestId: 'request-timeout',
        status: 'timeout',
        is_ok: false,
        httpCode: 408,
      }),
    );
    await vitest.advanceTimersByTimeAsync(10_000);
    expect(
      webSocket.sentMessages.filter(
        (message) => message.requestId === 'request-timeout',
      ),
    ).toHaveLength(1);
    device.stop();
    vitest.useRealTimers();
  });

  testCase('快速重启时忽略旧连接的迟到关闭事件', () => {
    const firstWebSocket = new FakeWebSocket();
    const secondWebSocket = new FakeWebSocket();
    const availableWebSockets = [firstWebSocket, secondWebSocket];
    let connectionIndex = 0;
    const device = new R2RpcDevice({
      baseUrl: 'http://127.0.0.1:3000',
      deviceToken: 'dk_fixture',
      clientId: 'device-1',
      webSocketFactory: () =>
        availableWebSockets[connectionIndex++] as FakeWebSocket,
    });

    device.start();
    const staleCloseHandler = firstWebSocket.onclose;
    device.stop();
    device.start();
    staleCloseHandler?.({ code: 1006, reason: 'late close' });

    expect(device.state).toBe('connecting');
    device.stop();
  });
});
