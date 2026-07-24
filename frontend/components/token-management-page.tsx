'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ShieldX, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status-badge';
import {
  TokenCreateDialog,
  type CreateTokenValues,
} from '@/components/token-create-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getRequestErrorMessage, requestApi } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import type { ProjectRecord, TokenRecord } from '@/lib/models';

interface TokenAction {
  type: 'revoke' | 'delete';
  token: TokenRecord;
}

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
  const [searchText, setSearchText] = useState('');
  const [copiedTokenId, setCopiedTokenId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<TokenAction | null>(null);
  const queryClient = useQueryClient();

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

  const filteredTokens = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    if (!normalizedSearch) {
      return tokensQuery.data ?? [];
    }
    return (tokensQuery.data ?? []).filter((token) =>
      [
        token.name,
        token.description,
        token.status,
        token.token,
        token.projects.join(','),
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(normalizedSearch),
        ),
    );
  }, [searchText, tokensQuery.data]);

  async function copyToken(token: TokenRecord) {
    await navigator.clipboard.writeText(token.token);
    setCopiedTokenId(token.id);
    toast.success('令牌已复制');
    window.setTimeout(() => setCopiedTokenId(null), 1500);
  }

  const columns: Array<DataTableColumn<TokenRecord>> = [
    {
      key: 'name',
      header: '名称',
      render: (token) => (
        <div>
          <p className="font-medium">{token.name}</p>
          <p className="mt-0.5 max-w-56 text-xs text-muted-foreground">
            {token.description || '暂无说明'}
          </p>
        </div>
      ),
    },
    {
      key: 'token',
      header: '令牌',
      render: (token) => (
        <div className="flex max-w-72 items-center gap-1">
          <code className="truncate rounded bg-muted px-2 py-1 font-mono text-xs">
            {token.token}
          </code>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="复制令牌"
            onClick={() => void copyToken(token)}
          >
            {copiedTokenId === token.id ? <Check /> : <Copy />}
          </Button>
        </div>
      ),
    },
    {
      key: 'projects',
      header: '功能组',
      render: (token) => (
        <div className="flex max-w-64 flex-wrap gap-1">
          {token.projects.map((projectName) => (
            <Badge key={projectName} variant="secondary">
              {projectName}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (token) => <StatusBadge status={token.status} />,
    },
    ...(showOnlineDevices
      ? [
          {
            key: 'online-devices',
            header: '在线设备',
            render: (token: TokenRecord) => token.onlineDeviceCount ?? 0,
          },
        ]
      : []),
    {
      key: 'expiration',
      header: '过期时间',
      render: (token) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(token.expiresAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (token) => (
        <div className="flex gap-1">
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
            isSubmitting={createMutation.isPending}
            onCreate={async (values) => {
              await createMutation.mutateAsync(values);
            }}
          />
        }
      />
      {tokensQuery.isError ? <QueryErrorState /> : null}
      <SearchInput
        value={searchText}
        onChange={setSearchText}
        placeholder="搜索名称、令牌、功能组或状态"
      />
      <DataTable
        columns={columns}
        rows={filteredTokens}
        isLoading={tokensQuery.isLoading}
        emptyMessage="暂无令牌"
        rowKey={(token) => token.id}
      />
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
