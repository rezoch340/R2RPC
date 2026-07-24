import { R2RpcCaller } from '@r2rpc/javascript-sdk';

const caller = new R2RpcCaller({
  baseUrl: process.env.R2RPC_BASE_URL ?? 'http://127.0.0.1:3000',
  accessToken: process.env.R2RPC_ACCESS_TOKEN ?? '',
});
const targetClientIdentifier = process.env.R2RPC_TARGET_CLIENT_ID;

const response = await caller.invoke(
  'cn-nodes',
  'hello',
  { message: 'hello from caller' },
  {
    ...(targetClientIdentifier
      ? { clientId: targetClientIdentifier }
      : {}),
    timeoutSeconds: 10,
  },
);

console.log(JSON.stringify(response, null, 2));
