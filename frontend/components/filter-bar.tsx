'use client';

import { RotateCcw, Search } from 'lucide-react';
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

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterFieldDefinition<FilterKey extends string> {
  key: FilterKey;
  label: string;
  type?: 'text' | 'number' | 'datetime-local' | 'select';
  placeholder?: string;
  options?: FilterOption[];
}

export function FilterBar<FilterKey extends string>({
  fields,
  values,
  onChange,
  onSubmit,
  onReset,
}: {
  fields: Array<FilterFieldDefinition<FilterKey>>;
  values: Record<FilterKey, string>;
  onChange: (key: FilterKey, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  return (
    <form
      className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        onSubmit();
      }}
    >
      {fields.map((field) => (
        <div key={field.key} className="space-y-2">
          <Label htmlFor={`filter-${field.key}`}>{field.label}</Label>
          {field.type === 'select' ? (
            <Select
              value={values[field.key] || null}
              onValueChange={(selectedValue) =>
                onChange(
                  field.key,
                  typeof selectedValue === 'string' ? selectedValue : '',
                )
              }
            >
              <SelectTrigger
                id={`filter-${field.key}`}
                className="w-full"
                aria-label={field.label}
              >
                <SelectValue placeholder={field.placeholder ?? '全部'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>
                  {field.placeholder ?? '全部'}
                </SelectItem>
                {field.options?.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`filter-${field.key}`}
              type={field.type ?? 'text'}
              value={values[field.key]}
              placeholder={field.placeholder}
              onChange={(changeEvent) =>
                onChange(field.key, changeEvent.target.value)
              }
            />
          )}
        </div>
      ))}
      <div className="col-span-full flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onReset}>
          <RotateCcw />
          重置
        </Button>
        <Button type="submit">
          <Search />
          查询
        </Button>
      </div>
    </form>
  );
}
