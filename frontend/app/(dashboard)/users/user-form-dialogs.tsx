'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { UserRecord } from '@/lib/models';

export function UserCreateDialog({
  isSubmitting,
  onCreate,
}: {
  isSubmitting: boolean;
  onCreate: (values: {
    username: string;
    password: string;
    role: string;
    description: string;
  }) => Promise<void>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('admin');
  const [description, setDescription] = useState('');

  async function submitUser(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!username.trim() || password.length < 6) {
      toast.error('用户名不能为空，密码至少 6 位');
      return;
    }
    await onCreate({
      username: username.trim(),
      password,
      role,
      description: description.trim(),
    });
    setUsername('');
    setPassword('');
    setRole('admin');
    setDescription('');
    setIsOpen(false);
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>
        <Plus />
        新建账号
      </Button>
      <FormDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="新建后台账号"
        description="账号创建后再通过权限组分配实际权限。"
        submitLabel="创建"
        isSubmitting={isSubmitting}
        onSubmit={submitUser}
      >
        <div className="space-y-2">
          <Label htmlFor="new-username">用户名</Label>
          <Input
            id="new-username"
            value={username}
            maxLength={64}
            autoComplete="off"
            onChange={(changeEvent) => setUsername(changeEvent.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">初始密码</Label>
          <Input
            id="new-password"
            type="password"
            value={password}
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>展示角色</Label>
          <Select value={role} onValueChange={(value) => setRole(String(value))}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">admin</SelectItem>
              <SelectItem value="operator">operator</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            此字段仅展示，实际授权以权限组为准。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-user-description">说明</Label>
          <Textarea
            id="new-user-description"
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

export function UserDescriptionDialog({
  user,
  isSubmitting,
  onClose,
  onSave,
}: {
  user: UserRecord | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (userId: number, description: string) => Promise<void>;
}) {
  const [description, setDescription] = useState(user?.description ?? '');

  return (
    <FormDialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="修改账号资料"
      description={`仅修改 ${user?.username ?? ''} 的说明，不改变用户名与权限。`}
      isSubmitting={isSubmitting}
      onSubmit={async (formEvent) => {
        formEvent.preventDefault();
        if (user) {
          await onSave(user.id, description.trim());
          onClose();
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="user-description">说明</Label>
        <Textarea
          id="user-description"
          value={description}
          maxLength={255}
          onChange={(changeEvent) => setDescription(changeEvent.target.value)}
        />
      </div>
    </FormDialog>
  );
}

export function UserPasswordDialog({
  user,
  isSubmitting,
  onClose,
  onSave,
}: {
  user: UserRecord | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (userId: number, password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');

  return (
    <FormDialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="修改账号密码"
      description={`为 ${user?.username ?? ''} 设置新密码。系统日志不会记录密码明文。`}
      submitLabel="修改密码"
      isSubmitting={isSubmitting}
      onSubmit={async (formEvent) => {
        formEvent.preventDefault();
        if (!user || password.length < 6) {
          toast.error('新密码至少 6 位');
          return;
        }
        await onSave(user.id, password);
        onClose();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="updated-password">新密码</Label>
        <Input
          id="updated-password"
          type="password"
          value={password}
          minLength={6}
          maxLength={128}
          autoComplete="new-password"
          onChange={(changeEvent) => setPassword(changeEvent.target.value)}
        />
      </div>
    </FormDialog>
  );
}
