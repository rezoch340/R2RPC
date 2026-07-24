'use client';

import type { ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuthentication } from '@/lib/auth';

export function PermissionBoundary({
  action,
  subject,
  children,
}: {
  action: string;
  subject: string;
  children: ReactNode;
}) {
  const { can } = useAuthentication();
  if (can(action, subject)) {
    return children;
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
      <ShieldAlert className="size-4" />
      当前账号没有查看此页面的权限。
    </div>
  );
}
