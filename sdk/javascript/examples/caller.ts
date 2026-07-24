import { Rer0RpcCaller } from '@rer0rpc/javascript-sdk';

const caller = new Rer0RpcCaller({
  baseUrl: process.env.RER0RPC_BASE_URL ?? 'http://127.0.0.1:3000',
  accessToken: process.env.RER0RPC_ACCESS_TOKEN ?? '',
});
const targetClientIdentifier = process.env.RER0RPC_TARGET_CLIENT_ID;

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
