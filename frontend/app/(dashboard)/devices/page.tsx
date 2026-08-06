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
import type { DeviceRecord } from '@/lib/models';
import { useServerTable } from '@/lib/use-server-table';

interface DeviceFilters {
  clientId: string;
  platform: string;
  lastIp: string;
  status: string;
}

const EMPTY_FILTERS: DeviceFilters = {
  clientId: '',
  platform: '',
  lastIp: '',
  status: '',
};

const FILTER_FIELDS: Array<FilterFieldDefinition<keyof DeviceFilters>> = [
  { key: 'clientId', label: '设备编号', placeholder: '客户端编号' },
  { key: 'platform', label: '平台', placeholder: '平台名称' },
  { key: 'lastIp', label: '最后 IP', placeholder: 'IP 地址' },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { value: 'online', label: '在线' },
      { value: 'offline', label: '离线' },
      { value: 'stale', label: '失联' },
    ],
  },
];

export default function DevicesPage() {
  const [selectedDevice, setSelectedDevice] = useState<DeviceRecord | null>(
    null,
  );
  const table = useServerTable<DeviceRecord, DeviceFilters>({
    resourceKey: 'devices',
    endpoint: '/devices',
    emptyFilters: EMPTY_FILTERS,
  });

  const columns: Array<DataTableColumn<DeviceRecord>> = [
    {
      key: 'client',
      header: '客户端编号',
      render: (device) => (
        <code className="font-mono text-xs">{device.clientId}</code>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (device) => <StatusBadge status={device.status} />,
    },
    {
      key: 'platform',
      header: '平台',
      render: (device) => device.platform || '—',
    },
    {
      key: 'last-ip',
      header: '最后 IP',
      render: (device) => (
        <span className="font-mono text-xs">{device.lastIp || '—'}</span>
      ),
    },
    {
      key: 'max-in-flight',
      header: '并发上限',
      render: (device) => device.maxInFlight ?? '默认',
    },
    {
      key: 'last-seen',
      header: '最后在线',
      render: (device) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(device.lastSeenAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (device) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="查看设备详情"
          onClick={() => setSelectedDevice(device)}
        >
          <Eye />
        </Button>
      ),
    },
  ];

  return (
    <PermissionBoundary action="read" subject="device">
      <PageHeader
        eyebrow="Presence"
        title="设备"
        description="查看设备持久态、实时在线状态和最近一次连接信息。"
      />
      {table.isError ? <QueryErrorState /> : null}
      <FilterBar fields={FILTER_FIELDS} {...table.filterBarProps} />
      <DataTable
        columns={columns}
        {...table.tableProps}
        emptyMessage="暂无设备，设备首次通过 WebSocket 上线后会自动登记"
        rowKey={(device) => device.id}
        footer={<Pagination {...table.paginationProps} />}
      />

      <Dialog
        open={selectedDevice !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDevice(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>设备详情</DialogTitle>
            <DialogDescription>
              {selectedDevice?.clientId ?? ''}
            </DialogDescription>
          </DialogHeader>
          {selectedDevice ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Detail label="设备编号" value={selectedDevice.clientId} />
              <Detail
                label="设备令牌编号"
                value={String(selectedDevice.deviceTokenId ?? '—')}
              />
              <Detail label="平台" value={selectedDevice.platform || '—'} />
              <Detail label="最后 IP" value={selectedDevice.lastIp || '—'} />
              <Detail
                label="并发上限"
                value={String(selectedDevice.maxInFlight ?? '默认')}
              />
              <Detail
                label="最后在线"
                value={formatDateTime(selectedDevice.lastSeenAt)}
              />
              <div className="sm:col-span-2">
                <JsonBlock
                  title="设备扩展信息"
                  value={
                    selectedDevice.extra
                      ? parseDeviceExtra(selectedDevice.extra)
                      : null
                  }
                />
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </PermissionBoundary>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-sm">{value}</p>
    </div>
  );
}

function parseDeviceExtra(extra: string): unknown {
  try {
    return JSON.parse(extra);
  } catch {
    return extra;
  }
}
