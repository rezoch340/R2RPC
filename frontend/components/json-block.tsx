'use client';

import { CopyButton } from '@/components/copy-button';
import { formatJson } from '@/lib/format';

export function JsonBlock({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  const formattedValue = formatJson(value);

  return (
    <section className="overflow-hidden rounded-xl border bg-[#0a1419] text-slate-200">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <p className="font-mono text-[11px] font-semibold tracking-wider text-cyan-300 uppercase">
          {title}
        </p>
        <CopyButton
          value={formattedValue}
          label={`复制${title}`}
          successMessage={`${title}已复制`}
          className="text-slate-300 hover:bg-white/10 hover:text-white"
        />
      </header>
      <pre className="max-h-80 overflow-auto p-4 font-mono text-xs leading-6">
        {formattedValue}
      </pre>
    </section>
  );
}
