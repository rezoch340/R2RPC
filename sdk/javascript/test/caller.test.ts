import {
  describe,
  expect,
  it as testCase,
  vi as vitest,
} from 'vitest';
import { R2RpcCaller, R2RpcHttpError } from '../src/index.js';

describe('R2RpcCaller', () => {
  testCase('通过 Access Token 调用指定设备', async () => {
    const fetchImplementation = vitest.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: 'request-1',
          clientId: 'device-1',
          is_ok: true,
          status: 'ok',
          httpCode: 200,
          latencyMs: 5,
          payload: { message: 'hello' },
        }),
        { status: 201 },
      ),
    );
    const caller = new R2RpcCaller({
      baseUrl: 'http://127.0.0.1:3000/',
      accessToken: 'rk_fixture',
      fetchImplementation,
    });

    const response = await caller.invoke(
      'cn-nodes',
      'hello',
      { message: 'hello' },
      { clientId: 'device-1', timeoutSeconds: 5 },
    );

    expect(response.clientId).toBe('device-1');
    expect(fetchImplementation).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/rpc/invoke/cn-nodes/hello?clientId=device-1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer rk_fixture',
        }),
      }),
    );
  });

  testCase('保留 HTTP 错误状态和响应体', async () => {
    const caller = new R2RpcCaller({
      baseUrl: 'http://127.0.0.1:3000',
      accessToken: 'rk_fixture',
      fetchImplementation: vitest
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'unauthorized' }), {
            status: 401,
          }),
        ),
    });

    await expect(caller.listOnlineDevices('cn-nodes')).rejects.toEqual(
      expect.objectContaining<R2RpcHttpError>({
        statusCode: 401,
        responseBody: { message: 'unauthorized' },
      }),
    );
  });

  testCase('HTTP 错误不是 JSON 时保留原始文本', async () => {
    const caller = new R2RpcCaller({
      baseUrl: 'http://127.0.0.1:3000',
      accessToken: 'rk_fixture',
      fetchImplementation: vitest
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('gateway unavailable', { status: 503 })),
    });

    await expect(caller.listOnlineDevices('cn-nodes')).rejects.toEqual(
      expect.objectContaining<R2RpcHttpError>({
        statusCode: 503,
        responseBody: 'gateway unavailable',
      }),
    );
  });

  testCase('在发请求前拒绝非法调用参数', () => {
    const caller = new R2RpcCaller({
      baseUrl: 'http://127.0.0.1:3000',
      accessToken: 'rk_fixture',
      fetchImplementation: vitest.fn<typeof fetch>(),
    });

    expect(() =>
      caller.invoke('cn-nodes', 'hello', {}, { timeoutSeconds: 0 }),
    ).toThrow('timeoutSeconds');
    expect(() => caller.listOnlineDevices('')).toThrow('project');
  });
});
