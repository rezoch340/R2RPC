'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Eye, RotateCcw, Search } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildQueryString, requestApi } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type { PaginatedResponse, RequestLogRecord } from '@/lib/models';
import { RequestLogDetailContent } from './request-log-detail';

interface RequestFilters {
  project: string;
  action: string;
  clientId: string;
  status: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: RequestFilters = {
  project: '',
  action: '',
  clientId: '',
  status: '',
  from: '',
  to: '',
};

export default function RequestLogsPage() {
  const [draftFilters, setDraftFilters] =
    useState<RequestFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<RequestFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );

  const queryString = buildQueryString({
    ...appliedFilters,
    from: appliedFilters.from
      ? new Date(appliedFilters.from).toISOString()
      : undefined,
    to: appliedFilters.to
      ? new Date(appliedFilters.to).toISOString()
      : undefined,
    page,
    pageSize,
  });
  const requestsQuery = useQuery({
    queryKey: ['request-logs', appliedFilters, page, pageSize],
    queryFn: () =>
      requestApi<PaginatedResponse<RequestLogRecord>>(
        `/monitor/requests${queryString}`,
      ),
    placeholderData: keepPreviousData,
  });

  function updateDraftFilter(key: keyof RequestFilters, value: string) {
    setDraftFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

  function applyFilters(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setAppliedFilters(draftFilters);
    setPage(1);
  }

  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
  }

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
      key: 'status',
      header: '状态',
      render: (requestLog) => <StatusBadge status={requestLog.status} />,
    },
    {
      key: 'payload',
      header: '载荷索引',
      render: (requestLog) => (
        <StatusBadge status={requestLog.payloadState} />
      ),
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
      <form
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-6"
        onSubmit={applyFilters}
      >
        <FilterInput
          label="功能组"
          value={draftFilters.project}
          onChange={(value) => updateDraftFilter('project', value)}
        />
        <FilterInput
          label="动作"
          value={draftFilters.action}
          onChange={(value) => updateDraftFilter('action', value)}
        />
        <FilterInput
          label="设备编号"
          value={draftFilters.clientId}
          onChange={(value) => updateDraftFilter('clientId', value)}
        />
        <div className="space-y-2">
          <Label>状态</Label>
          <Select
            value={draftFilters.status || null}
            onValueChange={(value) =>
              updateDraftFilter(
                'status',
                typeof value === 'string' ? value : '',
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>全部状态</SelectItem>
              {['ok', 'failed', 'timeout'].map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FilterInput
          label="起始时间"
          type="datetime-local"
          value={draftFilters.from}
          onChange={(value) => updateDraftFilter('from', value)}
        />
        <FilterInput
          label="结束时间"
          type="datetime-local"
          value={draftFilters.to}
          onChange={(value) => updateDraftFilter('to', value)}
        />
        <div className="col-span-full flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={resetFilters}>
            <RotateCcw />
            重置
          </Button>
          <Button type="submit">
            <Search />
            查询
          </Button>
        </div>
      </form>
      {requestsQuery.isError ? <QueryErrorState /> : null}
      <DataTable
        columns={columns}
        rows={requestsQuery.data?.rows ?? []}
        isLoading={requestsQuery.isLoading}
        emptyMessage="暂无请求日志"
        rowKey={(requestLog) => requestLog.requestId}
      />
      <Pagination
        page={requestsQuery.data?.page ?? page}
        pageSize={requestsQuery.data?.pageSize ?? pageSize}
        total={requestsQuery.data?.total ?? 0}
        isFetching={requestsQuery.isFetching}
        onPageChange={setPage}
        onPageSizeChange={(newPageSize) => {
          setPageSize(newPageSize);
          setPage(1);
        }}
      />

      <Dialog
        open={selectedRequestId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRequestId(null);
          }
        }}
      >
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>请求详情</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {selectedRequestId ?? ''}
            </DialogDescription>
          </DialogHeader>
          {selectedRequestId ? (
            <RequestLogDetailContent requestId={selectedRequestId} />
          ) : null}
        </DialogContent>
      </Dialog>
    </PermissionBoundary>
  );
}

function FilterInput({
  label,
  value,
  type = 'text',
  onChange,
}: {
  label: string;
  value: string;
  type?: 'text' | 'datetime-local';
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
      />
    </div>
  );
}
