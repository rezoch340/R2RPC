'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { copyText, formatJson } from '@/lib/format';

export function JsonBlock({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const formattedValue = formatJson(value);

  async function copyFormattedValue() {
    await copyText(formattedValue);
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1500);
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-[#0a1419] text-slate-200">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <p className="font-mono text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
          {title}
        </p>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-slate-300 hover:bg-white/10 hover:text-white"
          aria-label={`复制${title}`}
          onClick={copyFormattedValue}
        >
          {isCopied ? <Check /> : <Copy />}
        </Button>
      </header>
      <pre className="max-h-80 overflow-auto p-4 font-mono text-xs leading-6">
        {formattedValue}
      </pre>
    </section>
  );
}
