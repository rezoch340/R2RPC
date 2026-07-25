'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { TokenProjectSelector } from '@/components/token-project-selector';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ProjectRecord, TokenRecord } from '@/lib/models';

export interface AccessTokenUpdateValues {
  projectNames: string[];
  expiresAt: string | null;
  maximumUsageCount: number | null;
}

export function AccessTokenEditDialog({
  token,
  projects,
  isSubmitting,
  onClose,
  onSave,
}: {
  token: TokenRecord;
  projects: ProjectRecord[];
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (values: AccessTokenUpdateValues) => Promise<void>;
}) {
  const [selectedProjectNames, setSelectedProjectNames] = useState<string[]>(
    token.projects,
  );
  const [expiresAt, setExpiresAt] = useState(
    dateTimeLocalValue(token.expiresAt),
  );
  const [maximumUsageCount, setMaximumUsageCount] = useState(
    token.maximumUsageCount?.toString() ?? '',
  );

  function toggleProject(projectName: string) {
    setSelectedProjectNames((currentProjectNames) =>
      currentProjectNames.includes(projectName)
        ? currentProjectNames.filter(
            (selectedProjectName) => selectedProjectName !== projectName,
          )
        : [...currentProjectNames, projectName],
    );
  }

  async function saveAccessToken(
    formEvent: React.FormEvent<HTMLFormElement>,
  ) {
    formEvent.preventDefault();
    if (selectedProjectNames.length === 0) {
      toast.error('至少选择一个功能组');
      return;
    }
    const parsedMaximumUsageCount = maximumUsageCount
      ? Number(maximumUsageCount)
      : null;
    if (
      parsedMaximumUsageCount !== null &&
      (!Number.isInteger(parsedMaximumUsageCount) ||
        parsedMaximumUsageCount < 1)
    ) {
      toast.error('最大调用次数必须是大于 0 的整数');
      return;
    }
    await onSave({
      projectNames: selectedProjectNames,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      maximumUsageCount: parsedMaximumUsageCount,
    });
  }

  return (
    <FormDialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title="编辑访问令牌"
      description={`${token.name} 保存后立即替换功能组和过期策略；已使用次数不会重置。`}
      submitLabel="保存令牌"
      isSubmitting={isSubmitting}
      onSubmit={saveAccessToken}
      contentClassName="sm:max-w-xl"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-token-expiration">过期时间</Label>
          <Input
            id="edit-token-expiration"
            type="datetime-local"
            value={expiresAt}
            onChange={(changeEvent) => setExpiresAt(changeEvent.target.value)}
          />
          <p className="text-xs text-muted-foreground">留空表示不按时间过期</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-token-maximum-usage-count">最大调用次数</Label>
          <Input
            id="edit-token-maximum-usage-count"
            type="number"
            min={1}
            max={2147483647}
            value={maximumUsageCount}
            placeholder="留空表示不限次数"
            onChange={(changeEvent) =>
              setMaximumUsageCount(changeEvent.target.value)
            }
          />
          <p className="text-xs text-muted-foreground">
            已使用 {token.usageCount ?? 0} 次，修改上限不会清零
          </p>
        </div>
      </div>
      <TokenProjectSelector
        projects={projects}
        selectedProjectNames={selectedProjectNames}
        onToggle={toggleProject}
      />
    </FormDialog>
  );
}

function dateTimeLocalValue(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 16);
}
