'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type {
  CatalogPermission,
  PermissionGroup,
} from '@/lib/models';

export interface PermissionGroupFormValues {
  name: string;
  description: string;
  permissionIds: number[];
}

export function PermissionGroupDialog({
  open,
  permissionGroup,
  permissions,
  isSubmitting,
  onClose,
  onSave,
}: {
  open: boolean;
  permissionGroup: PermissionGroup | null;
  permissions: CatalogPermission[];
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (values: PermissionGroupFormValues) => Promise<void>;
}) {
  const [name, setName] = useState(permissionGroup?.name ?? '');
  const [description, setDescription] = useState(
    permissionGroup?.description ?? '',
  );
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<number[]>(
    permissionGroup?.permissions.map((permission) => permission.id) ?? [],
  );

  function togglePermission(permissionId: number) {
    setSelectedPermissionIds((currentPermissionIds) =>
      currentPermissionIds.includes(permissionId)
        ? currentPermissionIds.filter(
            (currentPermissionId) => currentPermissionId !== permissionId,
          )
        : [...currentPermissionIds, permissionId],
    );
  }

  const permissionsBySubject = groupPermissionsBySubject(permissions);

  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title={permissionGroup ? '编辑权限组' : '新建权限组'}
      description="勾选权限目录中的能力，用户最终权限取所属组的并集。"
      submitLabel={permissionGroup ? '保存' : '创建'}
      isSubmitting={isSubmitting}
      contentClassName="max-h-[92svh] overflow-y-auto sm:max-w-2xl"
      onSubmit={async (formEvent) => {
        formEvent.preventDefault();
        if (!name.trim()) {
          toast.error('请输入权限组名称');
          return;
        }
        await onSave({
          name: name.trim(),
          description: description.trim(),
          permissionIds: selectedPermissionIds,
        });
        onClose();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="permission-group-name">名称</Label>
          <Input
            id="permission-group-name"
            value={name}
            maxLength={64}
            onChange={(changeEvent) => setName(changeEvent.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="permission-group-description">说明</Label>
          <Textarea
            id="permission-group-description"
            value={description}
            maxLength={255}
            className="min-h-8"
            onChange={(changeEvent) =>
              setDescription(changeEvent.target.value)
            }
          />
        </div>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">权限目录</legend>
        <div className="max-h-96 space-y-4 overflow-y-auto rounded-xl border p-3">
          {Array.from(permissionsBySubject.entries()).map(
            ([subject, subjectPermissions]) => (
              <section key={subject}>
                <p className="mb-2 font-mono text-[11px] font-semibold tracking-wider text-primary uppercase">
                  {subject}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {subjectPermissions.map((permission) => (
                    <label
                      key={permission.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg bg-muted/35 p-2 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPermissionIds.includes(permission.id)}
                        className="mt-0.5 size-4 accent-primary"
                        onChange={() => togglePermission(permission.id)}
                      />
                      <span>
                        <span className="block font-mono text-xs">
                          {permission.action}/{permission.subject}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {permission.description || '暂无说明'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            ),
          )}
          {permissions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              暂无权限目录
            </p>
          ) : null}
        </div>
      </fieldset>
    </FormDialog>
  );
}

function groupPermissionsBySubject(
  permissions: CatalogPermission[],
): Map<string, CatalogPermission[]> {
  const permissionsBySubject = new Map<string, CatalogPermission[]>();
  for (const permission of permissions) {
    const subjectPermissions =
      permissionsBySubject.get(permission.subject) ?? [];
    subjectPermissions.push(permission);
    permissionsBySubject.set(permission.subject, subjectPermissions);
  }
  return permissionsBySubject;
}
