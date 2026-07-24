import type { RpcInvokeResponse } from '@/lib/models';

export interface RpcDebuggerRequestSnapshot {
  method: 'POST';
  url: string;
  body: {
    timeoutSeconds: number;
    payload: Record<string, unknown>;
  };
}

export interface RpcDebuggerInvocationResult {
  request: RpcDebuggerRequestSnapshot;
  response: RpcInvokeResponse | { error: string };
  transportStatusCode: number;
  completedAt: string;
}
