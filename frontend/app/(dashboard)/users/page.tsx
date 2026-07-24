'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  Pencil,
  Power,
  PowerOff,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { FilterBar, type FilterFieldDefinition } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { RowActions } from '@/components/row-actions';
import { Badge } from '@/components/ui/badge';
import { getRequestErrorMessage, requestApi } from '@/lib/api-client';
import { useAuthentication } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { PermissionGroup, UserRecord } from '@/lib/models';
import { useClientPagination } from '@/lib/use-client-pagination';
import {
  UserCreateDialog,
  UserDescriptionDialog,
  UserPasswordDialog,
} from './user-form-dialogs';
import { UserRoleDialog } from './user-role-dialog';

interface UserConfirmation {
  type: 'toggle' | 'delete';
  user: UserRecord;
}

interface UserFilters {
  username: string;
  role: string;
  enabled: string;
}

const EMPTY_FILTERS: UserFilters = {
  username: '',
  role: '',
  enabled: '',
};

const FILTER_FIELDS: Array<FilterFieldDefinition<keyof UserFilters>> = [
  { key: 'username', label: '账号', placeholder: '用户名' },
  { key: 'role', label: '展示角色', placeholder: '角色名称' },
  {
    key: 'enabled',
    label: '状态',
    type: 'select',
    placeholder: '全部状态',
    options: [
      { value: 'enabled', label: '启用' },
      { value: 'disabled', label: '停用' },
    ],
  },
];

export default function UsersPage() {
  const [draftFilters, setDraftFilters] = useState<UserFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<UserFilters>(EMPTY_FILTERS);
  const [descriptionUser, setDescriptionUser] = useState<UserRecord | null>(
    null,
  );
  const [passwordUser, setPasswordUser] = useState<UserRecord | null>(null);
  const [roleUser, setRoleUser] = useState<UserRecord | null>(null);
  const [confirmation, setConfirmation] = useState<UserConfirmation | null>(
    null,
  );
  const queryClient = useQueryClient();
  const { user: authenticatedUser, can, isRoot } = useAuthentication();

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => requestApi<UserRecord[]>('/users'),
  });
  const permissionGroupsQuery = useQuery({
    queryKey: ['permission-groups'],
    queryFn: () => requestApi<PermissionGroup[]>('/rbac/roles'),
    enabled: can('read', 'rbac'),
  });

  const createMutation = useMutation({
    mutationFn: (values: {
      username: string;
      password: string;
      role: string;
      description: string;
    }) =>
      requestApi<UserRecord>('/users', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      toast.success('账号已创建');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '创建账号失败')),
  });

  const userMutation = useMutation({
    mutationFn: async ({
      userId,
      path,
      method,
      body,
    }: {
      userId: number;
      path: string;
      method: 'PATCH' | 'POST' | 'DELETE';
      body?: unknown;
    }) =>
      requestApi(`/users/${userId}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast.success('账号信息已更新');
      setConfirmation(null);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '账号操作失败')),
  });

  const roleMutation = useMutation({
    mutationFn: async ({
      userId,
      currentRoleIds,
      selectedRoleIds,
    }: {
      userId: number;
      currentRoleIds: number[];
      selectedRoleIds: number[];
    }) => {
      const rolesToAssign = selectedRoleIds.filter(
        (roleId) => !currentRoleIds.includes(roleId),
      );
      const rolesToRemove = currentRoleIds.filter(
        (roleId) => !selectedRoleIds.includes(roleId),
      );
      await Promise.all([
        ...rolesToAssign.map((roleId) =>
          requestApi(`/rbac/users/${userId}/roles/${roleId}`, {
            method: 'POST',
          }),
        ),
        ...rolesToRemove.map((roleId) =>
          requestApi(`/rbac/users/${userId}/roles/${roleId}`, {
            method: 'DELETE',
          }),
        ),
      ]);
    },
    onSuccess: async (unusedResponse, values) => {
      void unusedResponse;
      toast.success('权限组已更新');
      await queryClient.invalidateQueries({
        queryKey: ['user-roles', values.userId],
      });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '权限组更新失败')),
  });

  const filteredUsers = useMemo(() => {
    const normalizedUsername = appliedFilters.username.trim().toLowerCase();
    const normalizedRole = appliedFilters.role.trim().toLowerCase();
    return (usersQuery.data ?? []).filter((userRecord) => {
      const matchesUsername =
        !normalizedUsername ||
        userRecord.username.toLowerCase().includes(normalizedUsername);
      const matchesRole =
        !normalizedRole ||
        userRecord.role.toLowerCase().includes(normalizedRole);
      const enabledStatus = userRecord.enabled ? 'enabled' : 'disabled';
      const matchesEnabled =
        !appliedFilters.enabled || enabledStatus === appliedFilters.enabled;
      return matchesUsername && matchesRole && matchesEnabled;
    });
  }, [appliedFilters, usersQuery.data]);
  const pagination = useClientPagination(filteredUsers);

  function updateDraftFilter(key: keyof UserFilters, value: string) {
    setDraftFilters((currentFilters) => ({
      ...currentFilters,
      [key]: value,
    }));
  }

  function canMutateUser(userRecord: UserRecord): boolean {
    return (
      can('update', 'user') &&
      (!userRecord.isRoot || userRecord.id === authenticatedUser?.id)
    );
  }

  const columns: Array<DataTableColumn<UserRecord>> = [
    {
      key: 'username',
      header: '账号',
      render: (userRecord) => (
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{userRecord.username}</p>
            {userRecord.isRoot ? <Badge>Root</Badge> : null}
          </div>
          <p className="mt-0.5 max-w-64 text-xs text-muted-foreground">
            {userRecord.description || '暂无说明'}
          </p>
        </div>
      ),
    },
    {
      key: 'role',
      header: '展示角色',
      render: (userRecord) => (
        <span className="font-mono text-xs">{userRecord.role}</span>
      ),
    },
    {
      key: 'enabled',
      header: '状态',
      render: (userRecord) => (
        <Badge variant={userRecord.enabled ? 'default' : 'secondary'}>
          {userRecord.enabled ? '启用' : '停用'}
        </Badge>
      ),
    },
    {
      key: 'last-login',
      header: '最后登录',
      render: (userRecord) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(userRecord.lastLoginAt)}
        </span>
      ),
    },
    {
      key: 'created',
      header: '创建时间',
      render: (userRecord) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(userRecord.createdAt)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (userRecord) => {
        const accountCanBeMutated = canMutateUser(userRecord);
        return (
          <RowActions
            label={`操作账号 ${userRecord.username}`}
            actions={[
              {
                label: '修改资料',
                icon: <Pencil />,
                disabled: !accountCanBeMutated,
                onSelect: () => setDescriptionUser(userRecord),
              },
              {
                label: '修改密码',
                icon: <KeyRound />,
                disabled: !accountCanBeMutated,
                onSelect: () => setPasswordUser(userRecord),
              },
              {
                label: '配置权限组',
                icon: <ShieldCheck />,
                disabled: !isRoot || !accountCanBeMutated,
                onSelect: () => setRoleUser(userRecord),
              },
              {
                label: userRecord.enabled ? '停用账号' : '启用账号',
                icon: userRecord.enabled ? <PowerOff /> : <Power />,
                disabled: !accountCanBeMutated,
                separatorBefore: true,
                onSelect: () =>
                  setConfirmation({ type: 'toggle', user: userRecord }),
              },
              {
                label: '删除账号',
                icon: <Trash2 />,
                disabled:
                  !can('delete', 'user') ||
                  (userRecord.isRoot &&
                    userRecord.id !== authenticatedUser?.id),
                destructive: true,
                onSelect: () =>
                  setConfirmation({ type: 'delete', user: userRecord }),
              },
            ]}
          />
        );
      },
    },
  ];

  return (
    <PermissionBoundary action="read" subject="user">
      <PageHeader
        eyebrow="Administrators"
        title="后台账号"
        description="管理员账号的数据、密码、启停、删除和权限组绑定都遵守同一隔离策略。"
        actions={
          can('create', 'user') ? (
            <UserCreateDialog
              isSubmitting={createMutation.isPending}
              onCreate={async (values) => {
                await createMutation.mutateAsync(values);
              }}
            />
          ) : undefined
        }
      />
      {usersQuery.isError ? <QueryErrorState /> : null}
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
        isLoading={usersQuery.isLoading}
        emptyMessage="暂无后台账号"
        rowKey={(userRecord) => userRecord.id}
        footer={
          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            isFetching={usersQuery.isFetching}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        }
      />

      <UserDescriptionDialog
        key={`description-user-${descriptionUser?.id ?? 'closed'}`}
        user={descriptionUser}
        isSubmitting={userMutation.isPending}
        onClose={() => setDescriptionUser(null)}
        onSave={async (userId, description) => {
          await userMutation.mutateAsync({
            userId,
            path: '',
            method: 'PATCH',
            body: { description },
          });
        }}
      />
      <UserPasswordDialog
        key={`password-user-${passwordUser?.id ?? 'closed'}`}
        user={passwordUser}
        isSubmitting={userMutation.isPending}
        onClose={() => setPasswordUser(null)}
        onSave={async (userId, password) => {
          await userMutation.mutateAsync({
            userId,
            path: '/password',
            method: 'PATCH',
            body: { password },
          });
        }}
      />
      <UserRoleDialog
        key={`role-user-${roleUser?.id ?? 'closed'}`}
        user={roleUser}
        permissionGroups={permissionGroupsQuery.data ?? []}
        isSubmitting={roleMutation.isPending}
        onClose={() => setRoleUser(null)}
        onSave={async (userId, currentRoleIds, selectedRoleIds) => {
          await roleMutation.mutateAsync({
            userId,
            currentRoleIds,
            selectedRoleIds,
          });
        }}
      />
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmation(null);
          }
        }}
        title={
          confirmation?.type === 'delete'
            ? '删除后台账号'
            : confirmation?.user.enabled
              ? '停用后台账号'
              : '启用后台账号'
        }
        description={
          confirmation?.type === 'delete'
            ? `删除 ${confirmation.user.username} 后，该账号现有会话立即失效。`
            : `确认切换 ${confirmation?.user.username ?? ''} 的启用状态？`
        }
        confirmLabel={confirmation?.type === 'delete' ? '删除' : '确认'}
        isPending={userMutation.isPending}
        onConfirm={() => {
          if (!confirmation) {
            return;
          }
          userMutation.mutate({
            userId: confirmation.user.id,
            path: confirmation.type === 'delete' ? '' : '/enabled',
            method: confirmation.type === 'delete' ? 'DELETE' : 'POST',
            body:
              confirmation.type === 'toggle'
                ? { enabled: !confirmation.user.enabled }
                : undefined,
          });
        }}
      />
    </PermissionBoundary>
  );
}
