'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clock3, ListChecks } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { JsonBlock } from '@/components/json-block';
import { QueryErrorState } from '@/components/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { requestApi } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type { RequestLogDetail } from '@/lib/models';

export function RequestLogDetailContent({ requestId }: { requestId: string }) {
  const detailQuery = useQuery({
    queryKey: ['request-log', requestId],
    queryFn: () =>
      requestApi<RequestLogDetail>(`/monitor/requests/${requestId}`),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    );
  }
  if (detailQuery.isError || !detailQuery.data) {
    return <QueryErrorState message="请求详情加载失败" />;
  }

  const requestDetail = detailQuery.data;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryItem label="功能组" value={requestDetail.projectName} />
        <SummaryItem label="动作" value={requestDetail.actionName} />
        <SummaryItem
          label="耗时"
          value={`${requestDetail.latencyMs ?? 0} ms`}
        />
        <SummaryItem
          label="设备"
          value={requestDetail.clientId ?? '未分配'}
          copyLabel={requestDetail.clientId ? '复制设备编号' : undefined}
        />
        <SummaryItem label="状态" value={requestDetail.status} />
        <SummaryItem
          label="完成时间"
          value={formatDateTime(requestDetail.finishedAt)}
        />
      </div>

      {requestDetail.payloadUnavailable ? (
        <QueryErrorState message="Manticore 原始载荷暂不可用，标量脊柱仍可正常查看。" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <JsonBlock title="请求载荷" value={requestDetail.requestPayload} />
          <JsonBlock title="响应载荷" value={requestDetail.responsePayload} />
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          <h3 className="font-heading font-semibold">设备 AppAudit Step</h3>
        </div>
        {requestDetail.appAudit?.steps.map((auditStep) => (
          <details
            key={`${auditStep.sequence}-${auditStep.name}`}
            className="group overflow-hidden rounded-xl border bg-card"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary">
                {auditStep.sequence}
              </span>
              <span className="min-w-0 flex-1">
                <p className="font-medium">{auditStep.name}</p>
                <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                  {auditStep.code || '无步骤代码'}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-xs">
                <Clock3 className="size-3" />
                {auditStep.durationMs} ms
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            </summary>
            <div className="grid gap-3 border-t p-4 xl:grid-cols-3">
              <JsonBlock
                title="Step Request"
                value={auditStep.request ?? null}
              />
              <JsonBlock
                title="Step Response"
                value={auditStep.response ?? null}
              />
              <JsonBlock title="Step Error" value={auditStep.error ?? null} />
            </div>
          </details>
        ))}
        {!requestDetail.appAudit ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            设备未上报 AppAudit，或上报内容未通过 V1 契约校验。
          </div>
        ) : null}
      </section>
    </div>
  );
}

// 抽屉里空间够,长编号直接换行显示全值;copyLabel 传了才出复制按钮
function SummaryItem({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string;
  copyLabel?: string;
}) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-start gap-1">
        <p className="min-w-0 flex-1 break-all font-mono text-xs">{value}</p>
        {copyLabel ? <CopyButton value={value} label={copyLabel} /> : null}
      </div>
    </div>
  );
}
