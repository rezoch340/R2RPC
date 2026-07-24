'use client';

import { useQuery } from '@tanstack/react-query';
import { Clock3, ListChecks } from 'lucide-react';
import { JsonBlock } from '@/components/json-block';
import { QueryErrorState } from '@/components/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { requestApi } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type { RequestLogDetail } from '@/lib/models';

export function RequestLogDetailContent({
  requestId,
}: {
  requestId: string;
}) {
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
          <article
            key={`${auditStep.sequence}-${auditStep.name}`}
            className="rounded-xl border bg-card p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">
                  {auditStep.sequence}. {auditStep.name}
                </p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {auditStep.code || '无步骤代码'}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-xs">
                <Clock3 className="size-3" />
                {auditStep.durationMs} ms
              </span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <JsonBlock title="Step Request" value={auditStep.request ?? null} />
              <JsonBlock
                title="Step Response"
                value={auditStep.response ?? null}
              />
              <JsonBlock title="Step Error" value={auditStep.error ?? null} />
            </div>
          </article>
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

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-xs">{value}</p>
    </div>
  );
}
