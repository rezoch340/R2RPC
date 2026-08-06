'use client';

import { useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Pencil, RotateCcw, ShieldX, Trash2 } from 'lucide-react';
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
import { RowActions } from '@/components/row-actions';
import { QueryErrorState } from '@/components/query-state';
import { StatusBadge } from '@/components/status-badge';
import {
  TokenCreateDialog,
  type CreateTokenValues,
} from '@/components/token-create-dialog';
import { TokenProjectsDialog } from '@/components/token-projects-dialog';
import { Badge } from '@/components/ui/badge';
import {
  getRequestErrorMessage,
  requestApi,
} from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type {
  ProjectRecord,
  TokenRecord,
} from '@/lib/models';
import { useServerTable } from '@/lib/use-server-table';

type TokenActionType = 'revoke' | 'delete' | 'reset-usage';

interface TokenAction {
  type: TokenActionType;
  token: TokenRecord;
}

// 三种操作的请求方式与文案集中在一处，避免在 JSX 里叠三元
const TOKEN_ACTIONS: Record<
  TokenActionType,
  {
    method: 'POST' | 'DELETE';
    pathSuffix: string;
    successMessage: string;
    title: string;
    confirmLabel: string;
    describe: (tokenName: string) => string;
  }
> = {
  revoke: {
    method: 'POST',
    pathSuffix: '/revoke',
    successMessage: '令牌已撤销',
    title: '撤销令牌',
    confirmLabel: '撤销',
    describe: (tokenName) =>
      `撤销 ${tokenName} 后，调用或设备连接将立即失效。`,
  },
  delete: {
    method: 'DELETE',
    pathSuffix: '',
    successMessage: '令牌已删除',
    title: '删除令牌',
    confirmLabel: '删除',
    describe: (tokenName) => `删除 ${tokenName} 后将不再出现在列表中。`,
  },
  'reset-usage': {
    method: 'POST',
    pathSuffix: '/reset-usage',
    successMessage: '调用次数已重置',
    title: '重置调用次数',
    confirmLabel: '重置',
    describe: (tokenName) =>
      `将 ${tokenName} 的总调用次数与当月调用一并清零，该令牌可继续调用。`,
  },
};

interface TokenFilters {
  id: string;
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
  id: '',
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
  const [editingToken, setEditingToken] = useState<TokenRecord | null>(null);
  const [pendingAction, setPendingAction] = useState<TokenAction | null>(null);
  const queryClient = useQueryClient();
  const allowsExpiration = resourcePath === '/access-tokens';
  const table = useServerTable<TokenRecord, TokenFilters>({
    resourceKey: resourceQueryKey,
    endpoint: resourcePath,
    emptyFilters: EMPTY_FILTERS,
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
        `${resourcePath}/${action.token.id}${TOKEN_ACTIONS[action.type].pathSuffix}`,
        { method: TOKEN_ACTIONS[action.type].method },
      ),
    onSuccess: async (unusedResponse, action) => {
      void unusedResponse;
      toast.success(TOKEN_ACTIONS[action.type].successMessage);
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

  const filterFields = useMemo<
    Array<FilterFieldDefinition<keyof TokenFilters>>
  >(
    () => [
      {
        key: 'id',
        label: '令牌编号',
        type: 'number',
        placeholder: '精确编号',
      },
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

  const columns: Array<DataTableColumn<TokenRecord>> = [
    {
      key: 'id',
      header: '令牌编号',
      className: 'w-24',
      render: (token) => (
        <code className="whitespace-nowrap font-mono text-xs">#{token.id}</code>
      ),
    },
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
            header: '总调用次数',
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
            key: 'monthly-usage-count',
            header: '当月调用',
            className: 'w-24',
            render: (token: TokenRecord) => (
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {token.monthlyUsageCount ?? 0}
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
      className: 'w-16',
      render: (token) => (
        <RowActions
          label={`操作令牌 ${token.name}`}
          actions={[
            {
              label: allowsExpiration ? '编辑令牌' : '编辑功能组',
              icon: <Pencil />,
              onSelect: () => setEditingToken(token),
            },
            // 重置只对 access token 有意义:device token 没有调用次数
            ...(allowsExpiration
              ? [
                  {
                    label: '重置调用次数',
                    icon: <RotateCcw />,
                    onSelect: () =>
                      setPendingAction({ type: 'reset-usage', token }),
                  },
                ]
              : []),
            {
              label: '撤销令牌',
              icon: <ShieldX />,
              disabled: token.status === 'revoked',
              separatorBefore: true,
              onSelect: () => setPendingAction({ type: 'revoke', token }),
            },
            {
              label: '删除令牌',
              icon: <Trash2 />,
              destructive: true,
              onSelect: () => setPendingAction({ type: 'delete', token }),
            },
          ]}
        />
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
      {table.isError ? <QueryErrorState /> : null}
      <FilterBar
        fields={filterFields}
        {...table.filterBarProps}
      />
      <DataTable
        columns={columns}
        {...table.tableProps}
        emptyMessage="暂无令牌"
        rowKey={(token) => token.id}
        tableClassName={
          allowsExpiration
            ? 'min-w-[1260px] table-fixed'
            : 'min-w-[1140px] table-fixed'
        }
        footer={
          <Pagination {...table.paginationProps} />
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
        title={pendingAction ? TOKEN_ACTIONS[pendingAction.type].title : ''}
        description={
          pendingAction
            ? TOKEN_ACTIONS[pendingAction.type].describe(pendingAction.token.name)
            : ''
        }
        confirmLabel={
          pendingAction ? TOKEN_ACTIONS[pendingAction.type].confirmLabel : ''
        }
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
