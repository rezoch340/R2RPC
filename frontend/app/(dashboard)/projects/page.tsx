'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power, PowerOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { FilterBar, type FilterFieldDefinition } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { RowActions } from '@/components/row-actions';
import { Pagination } from '@/components/pagination';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { StatusBadge } from '@/components/status-badge';
import { getRequestErrorMessage, requestApi } from '@/lib/api-client';
import { useAuthentication } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { ProjectRecord, ProjectStats } from '@/lib/models';
import { useServerTable } from '@/lib/use-server-table';
import { ProjectCreateDialog } from './project-create-dialog';

interface ProjectAction {
  type: 'toggle' | 'delete';
  project: ProjectRecord;
}

interface ProjectFilters {
  name: string;
  enabled: string;
}

const EMPTY_FILTERS: ProjectFilters = {
  name: '',
  enabled: '',
};

const FILTER_FIELDS: Array<FilterFieldDefinition<keyof ProjectFilters>> = [
  { key: 'name', label: '名称', placeholder: '功能组名称' },
  {
    key: 'enabled',
    label: '启用状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { value: 'enabled', label: '启用' },
      { value: 'disabled', label: '停用' },
    ],
  },
];

export default function ProjectsPage() {
  const [pendingAction, setPendingAction] = useState<ProjectAction | null>(
    null,
  );
  const queryClient = useQueryClient();
  const { can } = useAuthentication();
  const table = useServerTable<ProjectRecord, ProjectFilters>({
    resourceKey: 'projects-info',
    endpoint: '/projects/info',
    emptyFilters: EMPTY_FILTERS,
  });
  // 设备数、近 7 天请求、成功率、运行态都是派生值,进不了 WHERE,由当页 id 二次请求
  const projectIds = table.rows.map((project) => project.id);
  const statsQuery = useQuery({
    queryKey: ['projects', 'stats', projectIds],
    queryFn: () =>
      requestApi<ProjectStats[]>(
        `/projects/stats?ids=${projectIds.join(',')}`,
      ),
    enabled: projectIds.length > 0,
  });
  const statsByProjectId = new Map(
    (statsQuery.data ?? []).map((stats) => [stats.projectId, stats]),
  );

  const createMutation = useMutation({
    mutationFn: (values: { name: string; description: string }) =>
      requestApi<ProjectRecord>('/projects', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      toast.success('功能组已创建');
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '创建功能组失败')),
  });

  const updateMutation = useMutation({
    mutationFn: async (action: ProjectAction) => {
      if (action.type === 'delete') {
        return requestApi(`/projects/${action.project.id}`, {
          method: 'DELETE',
        });
      }
      return requestApi(`/projects/${action.project.id}/enabled`, {
        method: 'POST',
        body: JSON.stringify({ enabled: !action.project.enabled }),
      });
    },
    onSuccess: async (unusedResponse, action) => {
      void unusedResponse;
      toast.success(
        action.type === 'delete'
          ? '功能组已删除'
          : action.project.enabled
            ? '功能组已停用'
            : '功能组已启用',
      );
      setPendingAction(null);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '操作功能组失败')),
  });


  const columns: Array<DataTableColumn<ProjectRecord>> = [
    {
      key: 'name',
      header: '名称',
      render: (project) => (
        <div>
          <p className="font-medium">{project.name}</p>
          <p className="mt-0.5 max-w-64 text-xs text-muted-foreground">
            {project.description || '暂无说明'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: '运行态',
      render: (project) => (
        <StatusBadge
          status={statsByProjectId.get(project.id)?.status ?? 'offline'}
        />
      ),
    },
    {
      key: 'devices',
      header: '设备',
      render: (project) => (
        <span className="font-mono text-xs">
          {formatNumber(statsByProjectId.get(project.id)?.onlineDevices)} /{' '}
          {formatNumber(statsByProjectId.get(project.id)?.totalDevices)}
        </span>
      ),
    },
    {
      key: 'requests',
      header: '近 7 天请求',
      render: (project) =>
        formatNumber(statsByProjectId.get(project.id)?.requests7d),
    },
    {
      key: 'success-rate',
      header: '成功率',
      render: (project) =>
        `${statsByProjectId.get(project.id)?.successRate ?? 0}%`,
    },
    {
      key: 'last-seen',
      header: '最后在线',
      render: (project) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(statsByProjectId.get(project.id)?.lastSeenAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-16',
      render: (project) => (
        <RowActions
          label={`操作功能组 ${project.name}`}
          actions={[
            ...(can('update', 'project')
              ? [
                  {
                    label: project.enabled ? '停用功能组' : '启用功能组',
                    icon: project.enabled ? <PowerOff /> : <Power />,
                    onSelect: () =>
                      setPendingAction({ type: 'toggle', project }),
                  },
                ]
              : []),
            ...(can('delete', 'project')
              ? [
                  {
                    label: '删除功能组',
                    icon: <Trash2 />,
                    destructive: true,
                    onSelect: () =>
                      setPendingAction({ type: 'delete', project }),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  return (
    <PermissionBoundary action="read" subject="project">
      <PageHeader
        eyebrow="Routing"
        title="功能组"
        description="功能组是设备能力与调用权限之间的边界。"
        actions={
          can('create', 'project') ? (
            <ProjectCreateDialog
              isSubmitting={createMutation.isPending}
              onCreate={async (values) => {
                await createMutation.mutateAsync(values);
              }}
            />
          ) : undefined
        }
      />
      {table.isError ? <QueryErrorState /> : null}
      <FilterBar
        fields={FILTER_FIELDS}
        {...table.filterBarProps}
      />
      <DataTable
        columns={columns}
        {...table.tableProps}
        emptyMessage="暂无功能组"
        rowKey={(project) => project.id}
        footer={
          <Pagination {...table.paginationProps} />
        }
      />
      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
          }
        }}
        title={
          pendingAction?.type === 'delete'
            ? '删除功能组'
            : pendingAction?.project.enabled
              ? '停用功能组'
              : '启用功能组'
        }
        description={
          pendingAction?.type === 'delete'
            ? `删除 ${pendingAction.project.name} 后将不再出现在管理列表中。`
            : `确认切换 ${pendingAction?.project.name ?? ''} 的启用状态？`
        }
        confirmLabel={pendingAction?.type === 'delete' ? '删除' : '确认'}
        destructive={
          pendingAction?.type === 'delete' ||
          pendingAction?.project.enabled === true
        }
        isPending={updateMutation.isPending}
        onConfirm={() => {
          if (pendingAction) {
            updateMutation.mutate(pendingAction);
          }
        }}
      />
    </PermissionBoundary>
  );
}
