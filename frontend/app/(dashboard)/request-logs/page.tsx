'use client';

import { useState } from 'react';
import { Eye } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { FilterBar, type FilterFieldDefinition } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/format';
import type { RequestLogRecord } from '@/lib/models';
import { toIsoDateRange, useServerTable } from '@/lib/use-server-table';
import { RequestLogDetailContent } from './request-log-detail';

interface RequestFilters {
  project: string;
  action: string;
  clientId: string;
  accessTokenId: string;
  status: string;
  payloadState: string;
  minimumLatencyMs: string;
  maximumLatencyMs: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: RequestFilters = {
  project: '',
  action: '',
  clientId: '',
  accessTokenId: '',
  status: '',
  payloadState: '',
  minimumLatencyMs: '',
  maximumLatencyMs: '',
  from: '',
  to: '',
};

const FILTER_FIELDS: Array<FilterFieldDefinition<keyof RequestFilters>> = [
  { key: 'project', label: '功能组', placeholder: '功能组名称' },
  { key: 'action', label: '动作', placeholder: '动作名称' },
  { key: 'clientId', label: '设备编号', placeholder: '客户端编号' },
  {
    key: 'accessTokenId',
    label: '访问令牌编号',
    type: 'number',
    placeholder: '精确编号',
  },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { value: 'ok', label: '成功' },
      { value: 'failed', label: '失败' },
      { value: 'timeout', label: '超时' },
    ],
  },
  {
    key: 'payloadState',
    label: '载荷索引',
    type: 'select',
    placeholder: '全部索引状态',
    options: [
      { value: 'pending', label: '等待索引' },
      { value: 'indexed', label: '已索引' },
      { value: 'failed', label: '索引失败' },
      { value: 'unavailable', label: '不可用' },
    ],
  },
  {
    key: 'minimumLatencyMs',
    label: '最小耗时',
    type: 'number',
    placeholder: '毫秒',
  },
  {
    key: 'maximumLatencyMs',
    label: '最大耗时',
    type: 'number',
    placeholder: '毫秒',
  },
  { key: 'from', label: '起始时间', type: 'datetime-local' },
  { key: 'to', label: '结束时间', type: 'datetime-local' },
];

export default function RequestLogsPage() {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const table = useServerTable<RequestLogRecord, RequestFilters>({
    resourceKey: 'request-logs',
    endpoint: '/monitor/requests',
    emptyFilters: EMPTY_FILTERS,
    transformFilters: toIsoDateRange,
  });


  const columns: Array<DataTableColumn<RequestLogRecord>> = [
    {
      key: 'request',
      header: '请求编号',
      render: (requestLog) => (
        <code className="block max-w-48 truncate font-mono text-xs">
          {requestLog.requestId}
        </code>
      ),
    },
    {
      key: 'route',
      header: '功能组 / 动作',
      render: (requestLog) => (
        <div>
          <p className="font-medium">{requestLog.projectName}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {requestLog.actionName}
          </p>
        </div>
      ),
    },
    {
      key: 'device',
      header: '设备',
      render: (requestLog) => (
        <code className="font-mono text-xs">
          {requestLog.clientId ?? '未分配'}
        </code>
      ),
    },
    {
      key: 'access-token',
      header: '访问令牌编号',
      className: 'w-28',
      render: (requestLog) =>
        requestLog.accessTokenId !== null ? (
          <code className="whitespace-nowrap font-mono text-xs">
            #{requestLog.accessTokenId}
          </code>
        ) : (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {requestLog.requesterUserId !== null ? '后台调用' : '未记录'}
          </span>
        ),
    },
    {
      key: 'status',
      header: '状态',
      render: (requestLog) => <StatusBadge status={requestLog.status} />,
    },
    {
      key: 'payload',
      header: '载荷索引',
      render: (requestLog) => <StatusBadge status={requestLog.payloadState} />,
    },
    {
      key: 'latency',
      header: '耗时',
      render: (requestLog) => `${requestLog.latencyMs ?? 0} ms`,
    },
    {
      key: 'created',
      header: '开始时间',
      render: (requestLog) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(requestLog.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (requestLog) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="查看请求详情"
          onClick={() => setSelectedRequestId(requestLog.requestId)}
        >
          <Eye />
        </Button>
      ),
    },
  ];

  return (
    <PermissionBoundary action="read" subject="monitor">
      <PageHeader
        eyebrow="Forensics"
        title="请求日志"
        description="列表读取 PostgreSQL 取证脊柱；打开详情后再通过接口懒加载 Manticore 载荷与 AppAudit Step。"
      />
      <FilterBar
        fields={FILTER_FIELDS}
        {...table.filterBarProps}
      />
      {table.isError ? <QueryErrorState /> : null}
      <DataTable
        columns={columns}
        {...table.tableProps}
        emptyMessage="暂无请求日志"
        rowKey={(requestLog) => requestLog.requestId}
        footer={
          <Pagination {...table.paginationProps} />
        }
      />

      <Sheet
        open={selectedRequestId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRequestId(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="max-w-none gap-0 p-0"
          style={{ width: '96rem', maxWidth: '96vw' }}
        >
          <SheetHeader className="border-b pr-12">
            <SheetTitle>请求详情</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {selectedRequestId ?? ''}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {selectedRequestId ? (
              <RequestLogDetailContent requestId={selectedRequestId} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </PermissionBoundary>
  );
}
