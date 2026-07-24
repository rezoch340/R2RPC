'use client';

import type { FormEventHandler, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel = '保存',
  isSubmitting,
  onSubmit,
  children,
  contentClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel?: string;
  isSubmitting: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          {children}
          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '提交中…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
