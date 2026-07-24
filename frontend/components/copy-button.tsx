'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { copyTextToClipboard } from '@/lib/clipboard';

export function CopyButton({
  value,
  label,
  successMessage = '已复制',
  errorMessage = '复制失败，请手动复制',
  className,
}: {
  value: string;
  label: string;
  successMessage?: string;
  errorMessage?: string;
  className?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);

  async function copyValue() {
    try {
      await copyTextToClipboard(value);
      setIsCopied(true);
      toast.success(successMessage);
      window.setTimeout(() => setIsCopied(false), 1500);
    } catch {
      toast.error(errorMessage);
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={className}
      aria-label={label}
      onClick={() => void copyValue()}
    >
      {isCopied ? <Check /> : <Copy />}
    </Button>
  );
}
