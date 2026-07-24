'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function ProjectCreateDialog({
  isSubmitting,
  onCreate,
}: {
  isSubmitting: boolean;
  onCreate: (values: { name: string; description: string }) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  async function submitProject(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!name.trim()) {
      return;
    }
    await onCreate({ name: name.trim(), description: description.trim() });
    setName('');
    setDescription('');
    setIsOpen(false);
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>
        <Plus />
        新建功能组
      </Button>
      <FormDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="新建功能组"
        description="设备令牌和访问令牌都通过功能组建立授权边界。"
        submitLabel="创建"
        isSubmitting={isSubmitting}
        onSubmit={submitProject}
      >
        <div className="space-y-2">
          <Label htmlFor="project-name">名称</Label>
          <Input
            id="project-name"
            value={name}
            maxLength={128}
            placeholder="payment"
            onChange={(changeEvent) => setName(changeEvent.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="project-description">说明</Label>
          <Textarea
            id="project-description"
            value={description}
            maxLength={255}
            placeholder="用于支付能力设备"
            onChange={(changeEvent) =>
              setDescription(changeEvent.target.value)
            }
          />
        </div>
      </FormDialog>
    </>
  );
}
