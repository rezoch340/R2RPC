'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { FilterBar, type FilterFieldDefinition } from '@/components/filter-bar';
import { PageHeader } from '@/components/page-header';
import { RowActions } from '@/components/row-actions';
import { Pagination } from '@/components/pagination';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getRequestErrorMessage, requestApi } from '@/lib/api-client';
import { useAuthentication } from '@/lib/auth';
import type { CatalogPermission, PermissionGroup } from '@/lib/models';
import { useServerTable } from '@/lib/use-server-table';
import { PermissionCreateDialog } from './permission-create-dialog';
import {
  PermissionGroupDialog,
  type PermissionGroupFormValues,
} from './permission-group-dialog';

interface PermissionGroupFilters {
  name: string;
  permission: string;
}

interface PermissionFilters {
  action: string;
  subject: string;
}

const EMPTY_GROUP_FILTERS: PermissionGroupFilters = {
  name: '',
  permission: '',
};

const EMPTY_PERMISSION_FILTERS: PermissionFilters = {
  action: '',
  subject: '',
};

const GROUP_FILTER_FIELDS: Array<
  FilterFieldDefinition<keyof PermissionGroupFilters>
> = [
  { key: 'name', label: '权限组', placeholder: '权限组名称' },
  {
    key: 'permission',
    label: '所含权限',
    placeholder: 'action/subject',
  },
];

const PERMISSION_FILTER_FIELDS: Array<
  FilterFieldDefinition<keyof PermissionFilters>
> = [
  { key: 'action', label: '动作', placeholder: 'read、manage…' },
  { key: 'subject', label: '资源', placeholder: 'device、user…' },
];

export default function PermissionGroupsPage() {
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PermissionGroup | null>(
    null,
  );
  const [deletingGroup, setDeletingGroup] = useState<PermissionGroup | null>(
    null,
  );
  const [deletingPermission, setDeletingPermission] =
    useState<CatalogPermission | null>(null);
  const { isRoot } = useAuthentication();
  const queryClient = useQueryClient();
  const groupTable = useServerTable<PermissionGroup, PermissionGroupFilters>({
    resourceKey: 'permission-groups',
    endpoint: '/rbac/roles',
    emptyFilters: EMPTY_GROUP_FILTERS,
  });
  const permissionTable = useServerTable<CatalogPermission, PermissionFilters>({
    resourceKey: 'permissions',
    endpoint: '/rbac/permissions',
    emptyFilters: EMPTY_PERMISSION_FILTERS,
  });

  // 编辑弹窗要列出整个权限目录供勾选,分页会截断,改用不分页的 options 源
  const permissionOptionsQuery = useQuery({
    queryKey: ['permissions', 'options'],
    queryFn: () => requestApi<CatalogPermission[]>('/rbac/permissions/options'),
  });

  const saveGroupMutation = useMutation({
    mutationFn: async ({
      permissionGroup,
      values,
    }: {
      permissionGroup: PermissionGroup | null;
      values: PermissionGroupFormValues;
    }) => {
      const savedGroup = permissionGroup
        ? await requestApi<PermissionGroup>(
            `/rbac/roles/${permissionGroup.id}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                name: values.name,
                description: values.description,
              }),
            },
          )
        : await requestApi<PermissionGroup>('/rbac/roles', {
            method: 'POST',
            body: JSON.stringify({
              name: values.name,
              description: values.description,
            }),
          });
      const currentPermissionIds =
        permissionGroup?.permissions.map((permission) => permission.id) ?? [];
      const permissionsToAttach = values.permissionIds.filter(
        (permissionId) => !currentPermissionIds.includes(permissionId),
      );
      const permissionsToDetach = currentPermissionIds.filter(
        (permissionId) => !values.permissionIds.includes(permissionId),
      );
      await Promise.all([
        ...permissionsToAttach.map((permissionId) =>
          requestApi(
            `/rbac/roles/${savedGroup.id}/permissions/${permissionId}`,
            { method: 'POST' },
          ),
        ),
        ...permissionsToDetach.map((permissionId) =>
          requestApi(
            `/rbac/roles/${savedGroup.id}/permissions/${permissionId}`,
            { method: 'DELETE' },
          ),
        ),
      ]);
    },
    onSuccess: async () => {
      toast.success('权限组已保存');
      await queryClient.invalidateQueries({
        queryKey: ['permission-groups'],
      });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '保存权限组失败')),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (permissionGroupId: number) =>
      requestApi(`/rbac/roles/${permissionGroupId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('权限组已删除');
      setDeletingGroup(null);
      await queryClient.invalidateQueries({
        queryKey: ['permission-groups'],
      });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '删除权限组失败')),
  });

  const createPermissionMutation = useMutation({
    mutationFn: (values: {
      action: string;
      subject: string;
      description: string;
    }) =>
      requestApi<CatalogPermission>('/rbac/permissions', {
        method: 'POST',
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      toast.success('权限已创建');
      await queryClient.invalidateQueries({ queryKey: ['permissions'] });
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '创建权限失败')),
  });

  const deletePermissionMutation = useMutation({
    mutationFn: (permissionId: number) =>
      requestApi(`/rbac/permissions/${permissionId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('权限已删除');
      setDeletingPermission(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['permissions'] }),
        queryClient.invalidateQueries({ queryKey: ['permission-groups'] }),
      ]);
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '删除权限失败')),
  });


  const groupColumns: Array<DataTableColumn<PermissionGroup>> = [
    {
      key: 'name',
      header: '权限组',
      render: (permissionGroup) => (
        <div>
          <p className="font-medium">{permissionGroup.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {permissionGroup.description || '暂无说明'}
          </p>
        </div>
      ),
    },
    {
      key: 'permissions',
      header: '权限',
      render: (permissionGroup) => (
        <div className="flex max-w-3xl flex-wrap gap-1">
          {permissionGroup.permissions.map((permission) => (
            <Badge key={permission.id} variant="secondary">
              {permission.action}/{permission.subject}
            </Badge>
          ))}
          {permissionGroup.permissions.length === 0 ? (
            <span className="text-xs text-muted-foreground">尚未配置</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-24',
      render: (permissionGroup) =>
        isRoot ? (
          <RowActions
            label={`操作权限组 ${permissionGroup.name}`}
            actions={[
              {
                label: '编辑权限组',
                icon: <Pencil />,
                onSelect: () => setEditingGroup(permissionGroup),
              },
              {
                label: '删除权限组',
                icon: <Trash2 />,
                destructive: true,
                separatorBefore: true,
                onSelect: () => setDeletingGroup(permissionGroup),
              },
            ]}
          />
        ) : (
          <span className="text-xs text-muted-foreground">仅 Root 可写</span>
        ),
    },
  ];

  const permissionColumns: Array<DataTableColumn<CatalogPermission>> = [
    {
      key: 'tuple',
      header: '权限',
      render: (permission) => (
        <code className="font-mono text-xs">
          {permission.action}/{permission.subject}
        </code>
      ),
    },
    {
      key: 'description',
      header: '说明',
      render: (permission) => permission.description || '—',
    },
    {
      key: 'actions',
      header: '操作',
      className: 'w-24',
      render: (permission) =>
        isRoot ? (
          <RowActions
            label={`操作权限 ${permission.action}/${permission.subject}`}
            actions={[
              {
                label: '删除权限',
                icon: <Trash2 />,
                destructive: true,
                onSelect: () => setDeletingPermission(permission),
              },
            ]}
          />
        ) : (
          <span className="text-xs text-muted-foreground">仅 Root 可写</span>
        ),
    },
  ];

  return (
    <PermissionBoundary action="read" subject="rbac">
      <PageHeader
        eyebrow="RBAC"
        title="权限组"
        description="权限组包含可委派权限，用户可属于多个组；所有 RBAC 写入只允许种子管理员执行。"
        actions={
          isRoot ? (
            <div className="flex gap-2">
              <PermissionCreateDialog
                isSubmitting={createPermissionMutation.isPending}
                onCreate={async (values) => {
                  await createPermissionMutation.mutateAsync(values);
                }}
              />
              <Button onClick={() => setIsCreatingGroup(true)}>
                <Plus />
                新建权限组
              </Button>
            </div>
          ) : undefined
        }
      />
      {groupTable.isError || permissionTable.isError ? (
        <QueryErrorState />
      ) : null}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">权限组列表</h2>
        <FilterBar
          fields={GROUP_FILTER_FIELDS}
          {...groupTable.filterBarProps}
        />
        <DataTable
          columns={groupColumns}
          {...groupTable.tableProps}
          emptyMessage="暂无权限组"
          rowKey={(permissionGroup) => permissionGroup.id}
          footer={
            <Pagination {...groupTable.paginationProps} />
          }
        />
      </section>
      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">权限目录</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            权限目录使用自由 action/subject 组合，新资源无需修改授权框架。
          </p>
        </div>
        <FilterBar
          fields={PERMISSION_FILTER_FIELDS}
          {...permissionTable.filterBarProps}
        />
        <DataTable
          columns={permissionColumns}
          {...permissionTable.tableProps}
          emptyMessage="暂无权限"
          rowKey={(permission) => permission.id}
          footer={
            <Pagination {...permissionTable.paginationProps} />
          }
        />
      </section>

      <PermissionGroupDialog
        key={
          editingGroup
            ? `editing-permission-group-${editingGroup.id}`
            : `new-permission-group-${isCreatingGroup}`
        }
        open={isCreatingGroup || editingGroup !== null}
        permissionGroup={editingGroup}
        permissions={permissionOptionsQuery.data ?? []}
        isSubmitting={saveGroupMutation.isPending}
        onClose={() => {
          setIsCreatingGroup(false);
          setEditingGroup(null);
        }}
        onSave={async (values) => {
          await saveGroupMutation.mutateAsync({
            permissionGroup: editingGroup,
            values,
          });
        }}
      />
      <ConfirmDialog
        open={deletingGroup !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingGroup(null);
          }
        }}
        title="删除权限组"
        description={`删除 ${deletingGroup?.name ?? ''} 后，关联用户将立即失去该组提供的权限。`}
        confirmLabel="删除"
        isPending={deleteGroupMutation.isPending}
        onConfirm={() => {
          if (deletingGroup) {
            deleteGroupMutation.mutate(deletingGroup.id);
          }
        }}
      />
      <ConfirmDialog
        open={deletingPermission !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingPermission(null);
          }
        }}
        title="删除权限"
        description={`删除 ${deletingPermission?.action ?? ''}/${deletingPermission?.subject ?? ''} 后，所有权限组都会失去该权限。`}
        confirmLabel="删除"
        isPending={deletePermissionMutation.isPending}
        onConfirm={() => {
          if (deletingPermission) {
            deletePermissionMutation.mutate(deletingPermission.id);
          }
        }}
      />
    </PermissionBoundary>
  );
}
