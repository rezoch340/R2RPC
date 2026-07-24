'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function Pagination({
  page,
  pageSize,
  total,
  isFetching,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        共 {total} 条 · 第 {currentPage}/{totalPages} 页
      </span>
      <div className="flex items-center gap-2">
        <Select
          value={String(pageSize)}
          disabled={isFetching}
          onValueChange={(value) => {
            if (typeof value === 'string') {
              onPageSizeChange(Number(value));
            }
          }}
        >
          <SelectTrigger size="sm" aria-label="每页条数">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 20, 50, 100].map((pageSizeOption) => (
              <SelectItem
                key={pageSizeOption}
                value={String(pageSizeOption)}
              >
                {pageSizeOption} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="上一页"
          disabled={currentPage <= 1 || isFetching}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="下一页"
          disabled={currentPage >= totalPages || isFetching}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
