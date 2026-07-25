'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, ShieldX, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CopyButton } from '@/components/copy-button';
import {
  AccessTokenEditDialog,
  type AccessTokenUpdateValues,
} from '@/components/access-token-edit-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { FilterBar, type FilterFieldDefinition } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { StatusBadge } from '@/components/status-badge';
import {
  TokenCreateDialog,
  type CreateTokenValues,
} from '@/components/token-create-dialog';
import { TokenProjectsDialog } from '@/components/token-projects-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getRequestErrorMessage, requestApi } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type { ProjectRecord, TokenRecord } from '@/lib/models';
import { useClientPagination } from '@/lib/use-client-pagination';

interface TokenAction {
  type: 'revoke' | 'delete';
  token: TokenRecord;
}

interface TokenFilters {
  name: string;
  project: string;
  status: string;
}

interface UpdateTokenProjectsInput {
  token: TokenRecord;
  projectNames: string[];
  accessTokenPolicy?: Omit<AccessTokenUpdateValues, 'projectNames'>;
}

const EMPTY_FILTERS: TokenFilters = {
  name: '',
  project: '',
  status: '',
};

export function TokenManagementPage({
  resourcePath,
  resourceQueryKey,
  permissionSubject,
  eyebrow,
  title,
  description,
  createDescription,
  showOnlineDevices = false,
}: {
  resourcePath: '/access-tokens' | '/device-tokens';
  resourceQueryKey: 'access-tokens' | 'device-tokens';
  permissionSubject: 'access-token' | 'device-token';
  eyebrow: string;
  title: string;
  description: string;
  createDescription: string;
  showOnlineDevices?: boolean;
}) {
  const [draftFilters, setDraftFilters] = useState<TokenFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<TokenFilters>(EMPTY_FILTERS);
  const [editingToken, setEditingToken] = useState<TokenRecord | null>(null);
  const [pendingAction, setPendingAction] = useState<TokenAction | null>(null);
  const queryClient = useQueryClient();
  const allowsExpiration = resourcePath === '/access-tokens';

  const tokensQuery = useQuery({
    queryKey: [resourceQueryKey],
    queryFn: () => requestApi<TokenRecord[]>(resourcePath),
  });
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => requestApi<ProjectRecord[]>('/projects'),
  });

  const createMutation = useMutation({
    mutationFn: (values: CreateTokenValues) =>
      requestApi<TokenRecord>(resourcePath, {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      toast.success('令牌已生成，可在列表中复制明文');
      await queryClient.invalidateQueries({ queryKey: [resourceQueryKey] });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '生成令牌失败')),
  });

  const actionMutation = useMutation({
    mutationFn: (action: TokenAction) =>
      requestApi(
        action.type === 'revoke'
          ? `${resourcePath}/${action.token.id}/revoke`
          : `${resourcePath}/${action.token.id}`,
        { method: action.type === 'revoke' ? 'POST' : 'DELETE' },
      ),
    onSuccess: async (unusedResponse, action) => {
      void unusedResponse;
      toast.success(action.type === 'revoke' ? '令牌已撤销' : '令牌已删除');
      setPendingAction(null);
      await queryClient.invalidateQueries({ queryKey: [resourceQueryKey] });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '操作令牌失败')),
  });

  const updateTokenMutation = useMutation({
    mutationFn: (input: UpdateTokenProjectsInput) =>
      requestApi<TokenRecord>(
        allowsExpiration
          ? `${resourcePath}/${input.token.id}`
          : `${resourcePath}/${input.token.id}/projects`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            projects: input.projectNames,
            ...input.accessTokenPolicy,
          }),
        },
      ),
    onSuccess: async () => {
      toast.success('令牌配置已更新');
      setEditingToken(null);
      await queryClient.invalidateQueries({ queryKey: [resourceQueryKey] });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '更新令牌配置失败')),
  });

  const filteredTokens = useMemo(() => {
    const normalizedName = appliedFilters.name.trim().toLowerCase();
    return (tokensQuery.data ?? []).filter((token) => {
      const matchesName =
        !normalizedName || token.name.toLowerCase().includes(normalizedName);
      const matchesProject =
        !appliedFilters.project ||
        token.projects.includes(appliedFilters.project);
      const matchesStatus =
        !appliedFilters.status || token.status === appliedFilters.status;
      return matchesName && matchesProject && matchesStatus;
    });
  }, [appliedFilters, tokensQuery.data]);
  const pagination = useClientPagination(filteredTokens);
  const filterFields = useMemo<
    Array<FilterFieldDefinition<keyof TokenFilters>>
  >(
    () => [
      { key: 'name', label: '名称', placeholder: '令牌名称' },
      {
        key: 'project',
        label: '功能组',
        type: 'select',
        placeholder: '全部功能组',
        options: (projectsQuery.data ?? []).map((project) => ({
          value: project.name,
          label: project.name,
        })),
      },
      {
        key: 'status',
        label: '状态',
        type: 'select',
        placeholder: '全部状态',
        options: [
          { value: 'active', label: '有效' },
          { value: 'revoked', label: '已撤销' },
        ],
      },
    ],
    [projectsQuery.data],
  );

  function updateDraftFilter(key: keyof TokenFilters, value: string) {
    setDraftFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

  const columns: Array<DataTableColumn<TokenRecord>> = [
    {
      key: 'name',
      header: '名称',
      className: 'w-52',
      render: (token) => (
        <div className="min-w-0">
          <p className="truncate font-medium" title={token.name}>
            {token.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {token.description || '暂无说明'}
          </p>
        </div>
      ),
    },
    {
      key: 'token',
      header: '令牌',
      className: 'w-60',
      render: (token) => (
        <div className="flex min-w-0 items-center gap-1">
          <code
            className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs"
            title={token.token}
          >
            {token.token}
          </code>
          <CopyButton
            value={token.token}
            label="复制令牌"
            successMessage="令牌已复制"
          />
        </div>
      ),
    },
    {
      key: 'projects',
      header: '功能组',
      className: 'w-72',
      render: (token) => (
        <div
          className="flex flex-wrap gap-1"
          title={token.projects.join('、')}
        >
          {token.projects.slice(0, 4).map((projectName) => (
            <Badge key={projectName} variant="secondary">
              {projectName}
            </Badge>
          ))}
          {token.projects.length > 4 ? (
            <Badge variant="outline">+{token.projects.length - 4}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      className: 'w-20',
      render: (token) => <StatusBadge status={token.status} />,
    },
    ...(showOnlineDevices
      ? [
          {
            key: 'online-devices',
            header: '在线设备',
            className: 'w-20',
            render: (token: TokenRecord) => token.onlineDeviceCount ?? 0,
          },
        ]
      : []),
    ...(allowsExpiration
      ? [
          {
            key: 'usage-count',
            header: '调用次数',
            className: 'w-28',
            render: (token: TokenRecord) => (
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {token.maximumUsageCount === null ||
                token.maximumUsageCount === undefined
                  ? `${token.usageCount ?? 0} / 不限`
                  : `${token.usageCount ?? 0} / ${token.maximumUsageCount}`}
              </span>
            ),
          },
          {
            key: 'expiration',
            header: '过期时间',
            className: 'w-36',
            render: (token: TokenRecord) => (
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {formatDateTime(token.expiresAt)}
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'actions',
      header: '操作',
      className: 'w-28',
      render: (token) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={allowsExpiration ? '编辑令牌' : '编辑功能组'}
            onClick={() => setEditingToken(token)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={token.status === 'revoked'}
            aria-label="撤销令牌"
            onClick={() => setPendingAction({ type: 'revoke', token })}
          >
            <ShieldX />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive"
            aria-label="删除令牌"
            onClick={() => setPendingAction({ type: 'delete', token })}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PermissionBoundary action="manage" subject={permissionSubject}>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <TokenCreateDialog
            title={`新建${title.replace('令牌', '')}令牌`}
            description={createDescription}
            projects={projectsQuery.data ?? []}
            allowsExpiration={allowsExpiration}
            allowsUsageLimit={allowsExpiration}
            isSubmitting={createMutation.isPending}
            onCreate={async (values) => {
              await createMutation.mutateAsync(values);
            }}
          />
        }
      />
      {tokensQuery.isError ? <QueryErrorState /> : null}
      <FilterBar
        fields={filterFields}
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
        isLoading={tokensQuery.isLoading}
        emptyMessage="暂无令牌"
        rowKey={(token) => token.id}
        tableClassName={
          allowsExpiration
            ? 'min-w-[1260px] table-fixed'
            : 'min-w-[1140px] table-fixed'
        }
        footer={
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            isFetching={tokensQuery.isFetching}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        }
      />
      {editingToken && allowsExpiration ? (
        <AccessTokenEditDialog
          token={editingToken}
          projects={projectsQuery.data ?? []}
          isSubmitting={updateTokenMutation.isPending}
          onClose={() => setEditingToken(null)}
          onSave={async (values) => {
            await updateTokenMutation.mutateAsync({
              token: editingToken,
              projectNames: values.projectNames,
              accessTokenPolicy: {
                expiresAt: values.expiresAt,
                maximumUsageCount: values.maximumUsageCount,
              },
            });
          }}
        />
      ) : null}
      {editingToken && !allowsExpiration ? (
        <TokenProjectsDialog
          token={editingToken}
          projects={projectsQuery.data ?? []}
          isSubmitting={updateTokenMutation.isPending}
          disconnectsDevices={showOnlineDevices}
          onClose={() => setEditingToken(null)}
          onSave={async (projectNames) => {
            await updateTokenMutation.mutateAsync({
              token: editingToken,
              projectNames,
            });
          }}
        />
      ) : null}
      <ConfirmDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
          }
        }}
        title={pendingAction?.type === 'revoke' ? '撤销令牌' : '删除令牌'}
        description={
          pendingAction?.type === 'revoke'
            ? `撤销 ${pendingAction.token.name} 后，调用或设备连接将立即失效。`
            : `删除 ${pendingAction?.token.name ?? ''} 后将不再出现在列表中。`
        }
        confirmLabel={pendingAction?.type === 'revoke' ? '撤销' : '删除'}
        isPending={actionMutation.isPending}
        onConfirm={() => {
          if (pendingAction) {
            actionMutation.mutate(pendingAction);
          }
        }}
      />
    </PermissionBoundary>
  );
}
