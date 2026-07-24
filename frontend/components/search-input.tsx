'use client';

import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full sm:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        placeholder={placeholder}
        className="bg-card pl-9 pr-9"
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
          aria-label="清空搜索"
          onClick={() => onChange('')}
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}
