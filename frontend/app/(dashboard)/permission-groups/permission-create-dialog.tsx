'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function PermissionCreateDialog({
  isSubmitting,
  onCreate,
}: {
  isSubmitting: boolean;
  onCreate: (values: {
    action: string;
    subject: string;
    description: string;
  }) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [action, setAction] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  return (
    <>
      <Button variant="outline" onClick={() => setIsOpen(true)}>
        <Plus />
        新建权限
      </Button>
      <FormDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="新建权限"
        description="action 与 subject 是自由字段，新增后可加入任意权限组。"
        submitLabel="创建"
        isSubmitting={isSubmitting}
        onSubmit={async (formEvent) => {
          formEvent.preventDefault();
          if (!action.trim() || !subject.trim()) {
            toast.error('action 和 subject 不能为空');
            return;
          }
          await onCreate({
            action: action.trim(),
            subject: subject.trim(),
            description: description.trim(),
          });
          setAction('');
          setSubject('');
          setDescription('');
          setIsOpen(false);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="permission-action">Action</Label>
            <Input
              id="permission-action"
              value={action}
              maxLength={64}
              placeholder="read"
              onChange={(changeEvent) => setAction(changeEvent.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="permission-subject">Subject</Label>
            <Input
              id="permission-subject"
              value={subject}
              maxLength={64}
              placeholder="device"
              onChange={(changeEvent) => setSubject(changeEvent.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="permission-description">说明</Label>
          <Textarea
            id="permission-description"
            value={description}
            maxLength={255}
            onChange={(changeEvent) =>
              setDescription(changeEvent.target.value)
            }
          />
        </div>
      </FormDialog>
    </>
  );
}
