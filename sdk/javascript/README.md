# RER0RPC JavaScript / TypeScript SDK

适用于 Node.js 20+、现代浏览器和 Electron 等具有标准 WebSocket/Fetch 能力的
JavaScript 环境。包同时提供设备端常驻连接和调用方 HTTP 客户端。

## 安装

当前仓库内本地安装：

```bash
(cd /path/to/RER0RPC/sdk/javascript && corepack pnpm install && corepack pnpm build)

# 在目标 JavaScript 工程中执行
pnpm add /path/to/RER0RPC/sdk/javascript
```

发布制品的包名为：

```bash
pnpm add @rer0rpc/javascript-sdk
```

## 设备上线

`clientId` 应由宿主应用首次安装时生成并持久化，后续启动复用同一个值。
`baseUrl` 传 RER0RPC HTTP(S) 服务根地址，不要附加 `/api/client/ws`。

```ts
import {
  AppAuditRecorder,
  Rer0RpcDevice,
} from '@rer0rpc/javascript-sdk';

const device = new Rer0RpcDevice({
  baseUrl: 'https://relay.example.com',
  deviceToken: process.env.RER0RPC_DEVICE_TOKEN!,
  clientId: 'android-installation-8e3412',
  platform: 'android-frida',
  extra: { applicationVersion: '1.4.0' },
  maxInFlight: 512,
  onStateChange: ({ state, reconnectAttempt }) => {
    console.log('RER0RPC state', state, reconnectAttempt);
  },
  onError: (error) => console.error(error),
});

device.registerAction('hello', async (job) => {
  const audit = new AppAuditRecorder('Hello 执行链路')
    .addMetadata('clientId', 'android-installation-8e3412');
  const step = audit.startStep({
    code: 'hello',
    name: '生成 Hello 响应',
    request: { method: 'LOCAL', body: job.payload },
  });

  try {
    const payload = { message: 'hello from device', received: job.payload };
    step.succeed({
      status: 200,
      response: { statusCode: 200, bodyFormat: 'json', body: payload },
    });
    return { payload, appAudit: audit.snapshot() };
  } catch (error) {
    step.fail({
      status: 500,
      error: {
        type: 'action',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return {
      status: 'error',
      isOk: false,
      httpCode: 500,
      error: 'hello 执行失败',
      appAudit: audit.snapshot(),
    };
  }
});

device.start();

// 进程退出或页面卸载时调用。
device.stop();
```

同名 Action 后注册的处理器会替换旧处理器；`registerAction()` 返回注销函数。未注册 Action
会自动返回 `404/error`。处理器抛错会返回 `500/error`，超过 Job 超时会返回
`408/timeout`。

## 调用 RPC

```ts
import { Rer0RpcCaller } from '@rer0rpc/javascript-sdk';

const caller = new Rer0RpcCaller({
  baseUrl: 'https://relay.example.com',
  accessToken: process.env.RER0RPC_ACCESS_TOKEN!,
});

const automaticResponse = await caller.invoke(
  'cn-nodes',
  'hello',
  { message: 'hello' },
  { timeoutSeconds: 10 },
);

const specifiedResponse = await caller.invoke(
  'cn-nodes',
  'hello',
  { message: 'hello device-001' },
  { clientId: 'device-001', timeoutSeconds: 10 },
);

const onlineDevices = await caller.listOnlineDevices('cn-nodes');
const deviceStatus = await caller.isDeviceOnline('cn-nodes', 'device-001');
```

`invoke()` 的最后一个参数还接受 `AbortSignal`。HTTP 非 2xx 响应会抛出
`Rer0RpcHttpError`，其中保留 `statusCode` 和服务端响应体。
`payload` 必须是 JSON object；数组、字符串和其他顶层标量不符合当前 invoke DTO。

## 开发验证

```bash
cd sdk/javascript
corepack pnpm install
corepack pnpm check
```

`check` 会依次执行 TypeScript 类型检查、Vitest 和制品构建。
