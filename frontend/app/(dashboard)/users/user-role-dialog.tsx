'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { QueryErrorState } from '@/components/query-state';
import { requestApi } from '@/lib/api-client';
import type { PermissionGroup, UserRecord } from '@/lib/models';

export function UserRoleDialog({
  user,
  permissionGroups,
  isSubmitting,
  onClose,
  onSave,
}: {
  user: UserRecord | null;
  permissionGroups: PermissionGroup[];
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (
    userId: number,
    currentRoleIds: number[],
    selectedRoleIds: number[],
  ) => Promise<void>;
}) {
  const [selectedRoleIds, setSelectedRoleIds] = useState<number[] | null>(null);
  const currentRolesQuery = useQuery({
    queryKey: ['user-roles', user?.id],
    queryFn: () =>
      requestApi<PermissionGroup[]>(`/rbac/users/${user?.id}/roles`),
    enabled: user !== null,
  });

  const effectiveSelectedRoleIds =
    selectedRoleIds ??
    currentRolesQuery.data?.map((permissionGroup) => permissionGroup.id) ??
    [];

  function toggleRole(roleId: number) {
    setSelectedRoleIds(
      effectiveSelectedRoleIds.includes(roleId)
        ? effectiveSelectedRoleIds.filter(
            (currentRoleId) => currentRoleId !== roleId,
          )
        : [...effectiveSelectedRoleIds, roleId],
    );
  }

  return (
    <FormDialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="配置权限组"
      description={`为 ${user?.username ?? ''} 分配权限组，最终权限取所有组的并集。`}
      submitLabel="保存权限组"
      isSubmitting={isSubmitting}
      onSubmit={async (formEvent) => {
        formEvent.preventDefault();
        if (!user || !currentRolesQuery.data) {
          toast.error('当前权限组尚未加载完成');
          return;
        }
        await onSave(
          user.id,
          currentRolesQuery.data.map(
            (permissionGroup) => permissionGroup.id,
          ),
          effectiveSelectedRoleIds,
        );
        onClose();
      }}
    >
      {currentRolesQuery.isError ? (
        <QueryErrorState message="用户权限组加载失败" />
      ) : null}
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border p-3">
        {permissionGroups.map((permissionGroup) => (
          <label
            key={permissionGroup.id}
            className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={effectiveSelectedRoleIds.includes(permissionGroup.id)}
              className="mt-0.5 size-4 accent-primary"
              onChange={() => toggleRole(permissionGroup.id)}
            />
            <span>
              <span className="block text-sm font-medium">
                {permissionGroup.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {permissionGroup.description || '暂无说明'} ·{' '}
                {permissionGroup.permissions.length} 项权限
              </span>
            </span>
          </label>
        ))}
        {permissionGroups.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            暂无权限组
          </p>
        ) : null}
      </div>
    </FormDialog>
  );
}
