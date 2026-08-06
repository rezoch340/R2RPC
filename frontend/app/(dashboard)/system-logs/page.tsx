'use client';

import { useState } from 'react';
import { Eye } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { FilterBar, type FilterFieldDefinition } from '@/components/filter-bar';
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
import { formatDateTime } from '@/lib/format';
import type { SystemLogRecord } from '@/lib/models';
import { toIsoDateRange, useServerTable } from '@/lib/use-server-table';

interface SystemLogFilters {
  name: string;
  actorUsername: string;
  action: string;
  subject: string;
  targetType: string;
  targetName: string;
  status: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: SystemLogFilters = {
  name: '',
  actorUsername: '',
  action: '',
  subject: '',
  targetType: '',
  targetName: '',
  status: '',
  from: '',
  to: '',
};

const FILTER_FIELDS: Array<FilterFieldDefinition<keyof SystemLogFilters>> = [
  { key: 'name', label: '事件', placeholder: '事件名称' },
  { key: 'actorUsername', label: '操作者', placeholder: '用户名' },
  { key: 'action', label: '动作', placeholder: 'read、create…' },
  { key: 'subject', label: '资源', placeholder: 'user、device…' },
  { key: 'targetType', label: '目标类型', placeholder: '目标类型' },
  { key: 'targetName', label: '目标名称', placeholder: '目标名称' },
  {
    key: 'status',
    label: '结果',
    type: 'select',
    placeholder: '全部结果',
    options: [
      { value: 'succeeded', label: '成功' },
      { value: 'failed', label: '失败' },
    ],
  },
  { key: 'from', label: '起始时间', type: 'datetime-local' },
  { key: 'to', label: '结束时间', type: 'datetime-local' },
];

export default function SystemLogsPage() {
  const [selectedLog, setSelectedLog] = useState<SystemLogRecord | null>(null);
  const table = useServerTable<SystemLogRecord, SystemLogFilters>({
    resourceKey: 'system-logs',
    endpoint: '/system-logs',
    emptyFilters: EMPTY_FILTERS,
    transformFilters: toIsoDateRange,
  });
  const columns: Array<DataTableColumn<SystemLogRecord>> = [
    {
      key: 'event',
      header: '事件',
      className: 'w-[34%] min-w-0',
      render: (systemLog) => (
        <div className="min-w-0">
          <p className="truncate font-medium" title={systemLog.name}>
            {systemLog.name}
          </p>
          <p
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={systemLog.description}
          >
            {systemLog.description}
          </p>
        </div>
      ),
    },
    {
      key: 'actor',
      header: '操作者',
      className: 'w-24',
      render: (systemLog) => (
        <span
          className="block truncate font-mono text-xs"
          title={systemLog.actorUsername}
        >
          {systemLog.actorUsername}
        </span>
      ),
    },
    {
      key: 'action',
      header: '动作 / 资源',
      className: 'w-28',
      render: (systemLog) => (
        <div className="min-w-0 font-mono text-xs">
          <p className="truncate" title={systemLog.action}>
            {systemLog.action}
          </p>
          <p className="truncate text-muted-foreground" title={systemLog.subject}>
            {systemLog.subject}
          </p>
        </div>
      ),
    },
    {
      key: 'target',
      header: '目标',
      className: 'w-56',
      render: (systemLog) => (
        <div className="min-w-0 text-xs">
          <p
            className="truncate"
            title={systemLog.targetName || systemLog.targetId || '—'}
          >
            {systemLog.targetName || systemLog.targetId || '—'}
          </p>
          <p
            className="truncate text-muted-foreground"
            title={systemLog.targetType}
          >
            {systemLog.targetType}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: '结果',
      className: 'w-20',
      render: (systemLog) => <StatusBadge status={systemLog.status} />,
    },
    {
      key: 'time',
      header: '时间',
      className: 'w-40',
      render: (systemLog) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(systemLog.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '详情',
      className: 'w-16 text-center',
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
      <FilterBar
        fields={FILTER_FIELDS}
        {...table.filterBarProps}
      />
      {table.isError ? <QueryErrorState /> : null}
      <DataTable
        columns={columns}
        {...table.tableProps}
        emptyMessage="暂无系统访问日志"
        rowKey={(systemLog) => systemLog.id}
        footer={
          <Pagination {...table.paginationProps} />
        }
        tableClassName="min-w-[1120px] table-fixed"
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
                <Detail label="错误" value={selectedLog.errorMessage || '—'} />
              </div>
              <JsonBlock title="安全元数据" value={selectedLog.metadata} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </PermissionBoundary>
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
