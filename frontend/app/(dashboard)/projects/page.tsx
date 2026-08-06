'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import type { ProjectRecord } from '@/lib/models';
import { refreshTableData, useTableQuery } from '@/lib/table-query';
import { useFilterState, type FilterState } from '@/lib/use-filter-state';
import { useClientPagination } from '@/lib/use-client-pagination';
import { ProjectCreateDialog } from './project-create-dialog';

interface ProjectAction {
  type: 'toggle' | 'delete';
  project: ProjectRecord;
}

interface ProjectFilters {
  name: string;
  status: string;
  enabled: string;
}

const EMPTY_FILTERS: ProjectFilters = {
  name: '',
  status: '',
  enabled: '',
};

const FILTER_FIELDS: Array<FilterFieldDefinition<keyof ProjectFilters>> = [
  { key: 'name', label: '名称', placeholder: '功能组名称' },
  {
    key: 'status',
    label: '运行态',
    type: 'select',
    placeholder: '全部运行态',
    options: [
      { value: 'online', label: '在线' },
      { value: 'offline', label: '离线' },
    ],
  },
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
  // 显式标注打断循环推导:filters -> pagination -> filteredProjects -> filters.applied
  const filters: FilterState<ProjectFilters> = useFilterState(EMPTY_FILTERS, {
    onApply: () => pagination.resetPage(),
    onReset: () => {
      pagination.resetPage();
      void refreshTableData(queryClient, ['projects', 'info']);
    },
  });
  const { can } = useAuthentication();

  const projectsQuery = useTableQuery({
    queryKey: ['projects', 'info'],
    queryFunction: () => requestApi<ProjectRecord[]>('/projects/info'),
  });

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

  const filteredProjects = useMemo(() => {
    const normalizedName = filters.applied.name.trim().toLowerCase();
    return (projectsQuery.data ?? []).filter((project) => {
      const matchesName =
        !normalizedName || project.name.toLowerCase().includes(normalizedName);
      const matchesStatus =
        !filters.applied.status || project.status === filters.applied.status;
      const enabledStatus = project.enabled ? 'enabled' : 'disabled';
      const matchesEnabled =
        !filters.applied.enabled || enabledStatus === filters.applied.enabled;
      return matchesName && matchesStatus && matchesEnabled;
    });
  }, [filters.applied, projectsQuery.data]);
  const pagination = useClientPagination(filteredProjects);

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
      render: (project) => <StatusBadge status={project.status ?? 'offline'} />,
    },
    {
      key: 'devices',
      header: '设备',
      render: (project) => (
        <span className="font-mono text-xs">
          {formatNumber(project.onlineDevices)} /{' '}
          {formatNumber(project.totalDevices)}
        </span>
      ),
    },
    {
      key: 'requests',
      header: '近 7 天请求',
      render: (project) => formatNumber(project.requests7d),
    },
    {
      key: 'success-rate',
      header: '成功率',
      render: (project) => `${project.successRate ?? 0}%`,
    },
    {
      key: 'last-seen',
      header: '最后在线',
      render: (project) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(project.lastSeenAt)}
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
      {projectsQuery.isError ? <QueryErrorState /> : null}
      <FilterBar
        fields={FILTER_FIELDS}
        values={filters.draft}
        onChange={filters.update}
        onSubmit={filters.apply}
        onReset={filters.reset}
      />
      <DataTable
        columns={columns}
        rows={pagination.pageRows}
        isLoading={projectsQuery.isLoading}
        emptyMessage="暂无功能组"
        rowKey={(project) => project.id}
        footer={
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
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
