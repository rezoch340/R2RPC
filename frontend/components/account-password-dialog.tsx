'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getRequestErrorMessage, requestApi } from '@/lib/api-client';

export function AccountPasswordDialog({
  open,
  userId,
  onClose,
}: {
  open: boolean;
  userId: number | undefined;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const passwordMutation = useMutation({
    mutationFn: (values: { userId: number; password: string }) =>
      requestApi(`/users/${values.userId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ password: values.password }),
      }),
    onSuccess: () => {
      toast.success('密码已修改');
      closeDialog();
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error, '修改密码失败')),
  });

  function closeDialog() {
    setPassword('');
    onClose();
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeDialog();
        }
      }}
      title="修改我的密码"
      description="密码明文不会写入系统操作日志。"
      submitLabel="修改密码"
      isSubmitting={passwordMutation.isPending}
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        if (!userId || password.length < 6) {
          toast.error('新密码至少 6 位');
          return;
        }
        passwordMutation.mutate({ userId, password });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="account-password">新密码</Label>
        <Input
          id="account-password"
          type="password"
          minLength={6}
          maxLength={128}
          value={password}
          autoComplete="new-password"
          onChange={(changeEvent) => setPassword(changeEvent.target.value)}
        />
      </div>
    </FormDialog>
  );
}
