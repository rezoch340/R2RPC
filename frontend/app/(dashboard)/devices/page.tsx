'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { JsonBlock } from '@/components/json-block';
import { PageHeader } from '@/components/page-header';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { requestApi } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type { DeviceRecord } from '@/lib/models';

export default function DevicesPage() {
  const [searchText, setSearchText] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<DeviceRecord | null>(
    null,
  );
  const devicesQuery = useQuery({
    queryKey: ['devices'],
    queryFn: () => requestApi<DeviceRecord[]>('/devices'),
    refetchInterval: 15_000,
  });

  const filteredDevices = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    if (!normalizedSearch) {
      return devicesQuery.data ?? [];
    }
    return (devicesQuery.data ?? []).filter((device) =>
      [
        device.clientId,
        device.platform,
        device.lastIp,
        device.status,
        device.description,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalizedSearch),
        ),
    );
  }, [devicesQuery.data, searchText]);

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
      {devicesQuery.isError ? <QueryErrorState /> : null}
      <SearchInput
        value={searchText}
        onChange={setSearchText}
        placeholder="搜索客户端编号、平台、IP 或状态"
      />
      <DataTable
        columns={columns}
        rows={filteredDevices}
        isLoading={devicesQuery.isLoading}
        emptyMessage="暂无设备，设备首次通过 WebSocket 上线后会自动登记"
        rowKey={(device) => device.id}
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
