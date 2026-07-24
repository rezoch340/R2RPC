'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power, PowerOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { FilterBar, type FilterFieldDefinition } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { getRequestErrorMessage, requestApi } from '@/lib/api-client';
import { useAuthentication } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { ProjectRecord } from '@/lib/models';
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
  const [draftFilters, setDraftFilters] =
    useState<ProjectFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<ProjectFilters>(EMPTY_FILTERS);
  const [pendingAction, setPendingAction] = useState<ProjectAction | null>(
    null,
  );
  const queryClient = useQueryClient();
  const { can } = useAuthentication();

  const projectsQuery = useQuery({
    queryKey: ['projects', 'info'],
    queryFn: () => requestApi<ProjectRecord[]>('/projects/info'),
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
    const normalizedName = appliedFilters.name.trim().toLowerCase();
    return (projectsQuery.data ?? []).filter((project) => {
      const matchesName =
        !normalizedName || project.name.toLowerCase().includes(normalizedName);
      const matchesStatus =
        !appliedFilters.status || project.status === appliedFilters.status;
      const enabledStatus = project.enabled ? 'enabled' : 'disabled';
      const matchesEnabled =
        !appliedFilters.enabled || enabledStatus === appliedFilters.enabled;
      return matchesName && matchesStatus && matchesEnabled;
    });
  }, [appliedFilters, projectsQuery.data]);
  const pagination = useClientPagination(filteredProjects);

  function updateDraftFilter(key: keyof ProjectFilters, value: string) {
    setDraftFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

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
      render: (project) => (
        <div className="flex items-center gap-1">
          {can('update', 'project') ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={project.enabled ? '停用功能组' : '启用功能组'}
              onClick={() => setPendingAction({ type: 'toggle', project })}
            >
              {project.enabled ? <PowerOff /> : <Power />}
            </Button>
          ) : null}
          {can('delete', 'project') ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="删除功能组"
              className="text-destructive"
              onClick={() => setPendingAction({ type: 'delete', project })}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
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
        values={draftFilters}
        onChange={updateDraftFilter}
        onSubmit={() => {
          setAppliedFilters(draftFilters);
          pagination.resetPage();
        }}
        onReset={() => {
          setDraftFilters(EMPTY_FILTERS);
          setAppliedFilters(EMPTY_FILTERS);
          pagination.resetPage();
        }}
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
            isFetching={projectsQuery.isFetching}
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
