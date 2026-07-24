'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { TokenProjectSelector } from '@/components/token-project-selector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ProjectRecord } from '@/lib/models';

export interface CreateTokenValues {
  name: string;
  description?: string;
  expiresAt?: string;
  projects: string[];
}

export function TokenCreateDialog({
  title,
  description,
  projects,
  isSubmitting,
  onCreate,
}: {
  title: string;
  description: string;
  projects: ProjectRecord[];
  isSubmitting: boolean;
  onCreate: (values: CreateTokenValues) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [tokenDescription, setTokenDescription] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

  function toggleProject(projectName: string) {
    setSelectedProjects((currentProjects) =>
      currentProjects.includes(projectName)
        ? currentProjects.filter(
            (selectedProject) => selectedProject !== projectName,
          )
        : [...currentProjects, projectName],
    );
  }

  async function submitToken(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!name.trim()) {
      toast.error('请输入令牌名称');
      return;
    }
    if (selectedProjects.length === 0) {
      toast.error('至少选择一个功能组');
      return;
    }
    await onCreate({
      name: name.trim(),
      description: tokenDescription.trim() || undefined,
      expiresAt: expiresAt
        ? new Date(expiresAt).toISOString()
        : undefined,
      projects: selectedProjects,
    });
    setName('');
    setTokenDescription('');
    setExpiresAt('');
    setSelectedProjects([]);
    setIsOpen(false);
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>
        <Plus />
        新建令牌
      </Button>
      <FormDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title={title}
        description={description}
        submitLabel="生成令牌"
        isSubmitting={isSubmitting}
        onSubmit={submitToken}
        contentClassName="sm:max-w-xl"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="token-name">名称</Label>
            <Input
              id="token-name"
              value={name}
              maxLength={128}
              placeholder="production-client"
              onChange={(changeEvent) => setName(changeEvent.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token-expiration">过期时间</Label>
            <Input
              id="token-expiration"
              type="datetime-local"
              value={expiresAt}
              onChange={(changeEvent) => setExpiresAt(changeEvent.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="token-description">说明</Label>
          <Textarea
            id="token-description"
            value={tokenDescription}
            maxLength={255}
            onChange={(changeEvent) =>
              setTokenDescription(changeEvent.target.value)
            }
          />
        </div>
        <TokenProjectSelector
          projects={projects}
          selectedProjectNames={selectedProjects}
          onToggle={toggleProject}
        />
      </FormDialog>
    </>
  );
}
