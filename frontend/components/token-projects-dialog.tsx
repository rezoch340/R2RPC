'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { TokenProjectSelector } from '@/components/token-project-selector';
import type { ProjectRecord, TokenRecord } from '@/lib/models';

export function TokenProjectsDialog({
  token,
  projects,
  isSubmitting,
  disconnectsDevices,
  onClose,
  onSave,
}: {
  token: TokenRecord;
  projects: ProjectRecord[];
  isSubmitting: boolean;
  disconnectsDevices: boolean;
  onClose: () => void;
  onSave: (projectNames: string[]) => Promise<void>;
}) {
  const [selectedProjectNames, setSelectedProjectNames] = useState<string[]>(
    token.projects,
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

  return (
    <FormDialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title="编辑令牌功能组"
      description={
        disconnectsDevices
          ? `${token.name} 保存后将立即替换作用域，并断开关联在线设备以使用新作用域重连。`
          : `${token.name} 保存后将立即替换调用作用域并清除鉴权缓存。`
      }
      submitLabel="保存功能组"
      isSubmitting={isSubmitting}
      onSubmit={async (formEvent) => {
        formEvent.preventDefault();
        if (selectedProjectNames.length === 0) {
          toast.error('至少选择一个功能组');
          return;
        }
        await onSave(selectedProjectNames);
      }}
      contentClassName="sm:max-w-xl"
    >
      <TokenProjectSelector
        projects={projects}
        selectedProjectNames={selectedProjectNames}
        onToggle={toggleProject}
      />
    </FormDialog>
  );
}
