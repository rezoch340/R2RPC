import { Clock3, RadioTower } from 'lucide-react';
import { JsonBlock } from '@/components/json-block';
import { StatusBadge } from '@/components/status-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import type { RpcInvokeResponse } from '@/lib/models';
import type { RpcDebuggerInvocationResult } from './rpc-debugger-types';

function isRpcInvokeResponse(
  response: RpcDebuggerInvocationResult['response'],
): response is RpcInvokeResponse {
  return 'requestId' in response;
}

function getResultDescription(
  isInvoking: boolean,
  invocationResult: RpcDebuggerInvocationResult | null,
): string {
  if (isInvoking) {
    return '请求已派发，正在等待设备返回。';
  }
  if (invocationResult) {
    return `完成于 ${formatDateTime(invocationResult.completedAt)}`;
  }
  return '发起调用后在这里查看原始请求和响应。';
}

export function RpcDebuggerResult({
  requestPreview,
  invocationResult,
  isInvoking,
}: {
  requestPreview: unknown;
  invocationResult: RpcDebuggerInvocationResult | null;
  isInvoking: boolean;
}) {
  const response = invocationResult?.response;
  const rpcResponse =
    response && isRpcInvokeResponse(response) ? response : null;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>调用结果</span>
          {rpcResponse ? <StatusBadge status={rpcResponse.status} /> : null}
        </CardTitle>
        <CardDescription>
          {getResultDescription(isInvoking, invocationResult)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {invocationResult ? (
          <ResultSummary invocationResult={invocationResult} />
        ) : null}
        <JsonBlock
          title={invocationResult ? '实际请求' : '请求预览'}
          value={invocationResult?.request ?? requestPreview}
        />
        {invocationResult ? (
          <JsonBlock title="响应结果" value={invocationResult.response} />
        ) : (
          <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
            暂无调用结果
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ResultSummary({
  invocationResult,
}: {
  invocationResult: RpcDebuggerInvocationResult;
}) {
  const response = invocationResult.response;
  const rpcResponse = isRpcInvokeResponse(response) ? response : null;
  const summaryItems = [
    {
      label: 'HTTP',
      value:
        invocationResult.transportStatusCode > 0
          ? String(invocationResult.transportStatusCode)
          : '网络错误',
      icon: RadioTower,
    },
    {
      label: '业务状态',
      value: rpcResponse?.status ?? '请求失败',
      icon: RadioTower,
    },
    {
      label: '设备',
      value: rpcResponse?.clientId ?? '—',
      icon: RadioTower,
    },
    {
      label: '耗时',
      value:
        rpcResponse?.latencyMs === undefined
          ? '—'
          : `${rpcResponse.latencyMs} ms`,
      icon: Clock3,
    },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {summaryItems.map((summaryItem) => {
        const SummaryIcon = summaryItem.icon;
        return (
          <div
            key={summaryItem.label}
            className="min-w-0 rounded-xl border bg-muted/30 p-3"
          >
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SummaryIcon className="size-3.5" />
              {summaryItem.label}
            </p>
            <p
              className="mt-1 truncate font-mono text-sm"
              title={summaryItem.value}
            >
              {summaryItem.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}
