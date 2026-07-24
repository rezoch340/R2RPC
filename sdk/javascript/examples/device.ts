import {
  AppAuditRecorder,
  R2RpcDevice,
} from '@r2rpc/javascript-sdk';

const device = new R2RpcDevice({
  baseUrl: process.env.R2RPC_BASE_URL ?? 'http://127.0.0.1:3000',
  deviceToken: process.env.R2RPC_DEVICE_TOKEN ?? '',
  clientId: process.env.R2RPC_CLIENT_ID ?? 'javascript-device-example',
  platform: 'nodejs',
  onStateChange: ({ state }) => console.log(`device state: ${state}`),
  onError: (error) => console.error(error),
});

device.registerAction('hello', (job) => {
  const audit = new AppAuditRecorder('JavaScript Hello');
  const step = audit.startStep({
    name: '构造响应',
    request: { method: 'LOCAL', body: job.payload },
  });
  const payload = { message: 'hello from JavaScript', received: job.payload };
  step.succeed({
    status: 200,
    response: { statusCode: 200, bodyFormat: 'json', body: payload },
  });
  return { payload, appAudit: audit.snapshot() };
});

device.start();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    device.stop();
    process.exit(0);
  });
}
