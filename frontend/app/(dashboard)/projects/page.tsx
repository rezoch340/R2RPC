'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power, PowerOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { getRequestErrorMessage, requestApi } from '@/lib/api-client';
import { useAuthentication } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { ProjectRecord } from '@/lib/models';
import { ProjectCreateDialog } from './project-create-dialog';

interface ProjectAction {
  type: 'toggle' | 'delete';
  project: ProjectRecord;
}

export default function ProjectsPage() {
  const [searchText, setSearchText] = useState('');
  const [pendingAction, setPendingAction] = useState<ProjectAction | null>(null);
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
    const normalizedSearch = searchText.trim().toLowerCase();
    if (!normalizedSearch) {
      return projectsQuery.data ?? [];
    }
    return (projectsQuery.data ?? []).filter((project) =>
      [project.name, project.description, project.status]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalizedSearch),
        ),
    );
  }, [projectsQuery.data, searchText]);

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
        <StatusBadge status={project.status ?? 'offline'} />
      ),
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
      <SearchInput
        value={searchText}
        onChange={setSearchText}
        placeholder="搜索名称、说明或状态"
      />
      <DataTable
        columns={columns}
        rows={filteredProjects}
        isLoading={projectsQuery.isLoading}
        emptyMessage="暂无功能组"
        rowKey={(project) => project.id}
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
