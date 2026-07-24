'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Eye, RotateCcw, Search } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { JsonBlock } from '@/components/json-block';
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
import type { PaginatedResponse, SystemLogRecord } from '@/lib/models';

interface SystemLogFilters {
  actorUsername: string;
  action: string;
  subject: string;
  status: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: SystemLogFilters = {
  actorUsername: '',
  action: '',
  subject: '',
  status: '',
  from: '',
  to: '',
};

export default function SystemLogsPage() {
  const [draftFilters, setDraftFilters] =
    useState<SystemLogFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<SystemLogFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedLog, setSelectedLog] = useState<SystemLogRecord | null>(null);

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
  const systemLogsQuery = useQuery({
    queryKey: ['system-logs', appliedFilters, page, pageSize],
    queryFn: () =>
      requestApi<PaginatedResponse<SystemLogRecord>>(
        `/system-logs${queryString}`,
      ),
    placeholderData: keepPreviousData,
  });

  function updateFilter(key: keyof SystemLogFilters, value: string) {
    setDraftFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

  const columns: Array<DataTableColumn<SystemLogRecord>> = [
    {
      key: 'event',
      header: '事件',
      render: (systemLog) => (
        <div>
          <p className="font-medium">{systemLog.name}</p>
          <p className="mt-0.5 max-w-80 text-xs text-muted-foreground">
            {systemLog.description}
          </p>
        </div>
      ),
    },
    {
      key: 'actor',
      header: '操作者',
      render: (systemLog) => (
        <span className="font-mono text-xs">{systemLog.actorUsername}</span>
      ),
    },
    {
      key: 'action',
      header: '动作 / 资源',
      render: (systemLog) => (
        <div className="font-mono text-xs">
          <p>{systemLog.action}</p>
          <p className="text-muted-foreground">{systemLog.subject}</p>
        </div>
      ),
    },
    {
      key: 'target',
      header: '目标',
      render: (systemLog) => (
        <div className="max-w-52 text-xs">
          <p>{systemLog.targetName || systemLog.targetId || '—'}</p>
          <p className="text-muted-foreground">{systemLog.targetType}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: '结果',
      render: (systemLog) => <StatusBadge status={systemLog.status} />,
    },
    {
      key: 'time',
      header: '时间',
      render: (systemLog) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(systemLog.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '详情',
      render: (systemLog) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="查看系统日志详情"
          onClick={() => setSelectedLog(systemLog)}
        >
          <Eye />
        </Button>
      ),
    },
  ];

  return (
    <PermissionBoundary action="read" subject="system-log">
      <PageHeader
        eyebrow="Administrator audit"
        title="系统日志"
        description="不可变记录登录、控制面读取、拒绝访问和业务写入，回答谁在什么时候访问或修改了什么。"
      />
      <form
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 xl:grid-cols-6"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          setAppliedFilters(draftFilters);
          setPage(1);
        }}
      >
        <FilterInput
          label="操作者"
          value={draftFilters.actorUsername}
          onChange={(value) => updateFilter('actorUsername', value)}
        />
        <FilterInput
          label="动作"
          value={draftFilters.action}
          onChange={(value) => updateFilter('action', value)}
        />
        <FilterInput
          label="资源"
          value={draftFilters.subject}
          onChange={(value) => updateFilter('subject', value)}
        />
        <div className="space-y-2">
          <Label>结果</Label>
          <Select
            value={draftFilters.status || null}
            onValueChange={(value) =>
              updateFilter(
                'status',
                typeof value === 'string' ? value : '',
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="全部结果" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>全部结果</SelectItem>
              <SelectItem value="succeeded">成功</SelectItem>
              <SelectItem value="failed">失败</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <FilterInput
          label="起始时间"
          type="datetime-local"
          value={draftFilters.from}
          onChange={(value) => updateFilter('from', value)}
        />
        <FilterInput
          label="结束时间"
          type="datetime-local"
          value={draftFilters.to}
          onChange={(value) => updateFilter('to', value)}
        />
        <div className="col-span-full flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraftFilters(EMPTY_FILTERS);
              setAppliedFilters(EMPTY_FILTERS);
              setPage(1);
            }}
          >
            <RotateCcw />
            重置
          </Button>
          <Button type="submit">
            <Search />
            查询
          </Button>
        </div>
      </form>
      {systemLogsQuery.isError ? <QueryErrorState /> : null}
      <DataTable
        columns={columns}
        rows={systemLogsQuery.data?.rows ?? []}
        isLoading={systemLogsQuery.isLoading}
        emptyMessage="暂无系统访问日志"
        rowKey={(systemLog) => systemLog.id}
      />
      <Pagination
        page={systemLogsQuery.data?.page ?? page}
        pageSize={systemLogsQuery.data?.pageSize ?? pageSize}
        total={systemLogsQuery.data?.total ?? 0}
        isFetching={systemLogsQuery.isFetching}
        onPageChange={setPage}
        onPageSizeChange={(newPageSize) => {
          setPageSize(newPageSize);
          setPage(1);
        }}
      />

      <Dialog
        open={selectedLog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedLog(null);
          }
        }}
      >
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedLog?.name ?? '系统日志详情'}</DialogTitle>
            <DialogDescription>
              {selectedLog?.description ?? ''}
            </DialogDescription>
          </DialogHeader>
          {selectedLog ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="操作者" value={selectedLog.actorUsername} />
                <Detail
                  label="动作"
                  value={`${selectedLog.action}/${selectedLog.subject}`}
                />
                <Detail
                  label="目标"
                  value={
                    selectedLog.targetName ||
                    selectedLog.targetId ||
                    selectedLog.targetType
                  }
                />
                <Detail
                  label="HTTP"
                  value={`${selectedLog.method} ${selectedLog.statusCode}`}
                />
                <Detail label="路由" value={selectedLog.route} />
                <Detail
                  label="时间"
                  value={formatDateTime(selectedLog.createdAt)}
                />
                <Detail label="IP" value={selectedLog.ipAddress || '—'} />
                <Detail
                  label="错误"
                  value={selectedLog.errorMessage || '—'}
                />
              </div>
              <JsonBlock title="安全元数据" value={selectedLog.metadata} />
            </div>
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-xs">{value}</p>
    </div>
  );
}
