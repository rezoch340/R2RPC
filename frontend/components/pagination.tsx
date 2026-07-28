'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';

type PaginationItem = number | 'leading-ellipsis' | 'trailing-ellipsis';

function pageItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from(
      { length: totalPages },
      (unusedValue, index) => index + 1,
    );
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, 'trailing-ellipsis', totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [
      1,
      'leading-ellipsis',
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }

  return [
    1,
    'leading-ellipsis',
    currentPage - 1,
    currentPage,
    currentPage + 1,
    'trailing-ellipsis',
    totalPages,
  ];
}

export function Pagination({
  page,
  pageSize,
  total,
  isPageTransitioning = false,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  isPageTransitioning?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const [jumpPage, setJumpPage] = useState('');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstItemNumber = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItemNumber = Math.min(currentPage * pageSize, total);

  function jumpToPage(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const requestedPage = Number(jumpPage);
    if (!Number.isInteger(requestedPage) || requestedPage < 1) {
      return;
    }
    onPageChange(Math.min(requestedPage, totalPages));
    setJumpPage('');
  }

  return (
    <div className="flex flex-col gap-3 text-sm text-muted-foreground xl:flex-row xl:items-center xl:justify-between">
      <span className="whitespace-nowrap">
        第 {firstItemNumber}-{lastItemNumber} 条 / 共 {total} 条
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="上一页"
          disabled={currentPage <= 1 || isPageTransitioning}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft />
        </Button>
        {pageItems(currentPage, totalPages).map((pageItem) =>
          typeof pageItem === 'number' ? (
            <Button
              key={pageItem}
              type="button"
              variant={pageItem === currentPage ? 'outline' : 'ghost'}
              size="icon-sm"
              className={
                pageItem === currentPage
                  ? 'border-primary text-primary hover:bg-primary/5 hover:text-primary'
                  : undefined
              }
              aria-label={`第 ${pageItem} 页`}
              aria-current={pageItem === currentPage ? 'page' : undefined}
              disabled={isPageTransitioning}
              onClick={() => onPageChange(pageItem)}
            >
              {pageItem}
            </Button>
          ) : (
            <span
              key={pageItem}
              className="flex size-7 items-center justify-center text-muted-foreground/70"
              aria-hidden="true"
            >
              ···
            </span>
          ),
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="下一页"
          disabled={currentPage >= totalPages || isPageTransitioning}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRight />
        </Button>
        <Select
          value={String(pageSize)}
          disabled={isPageTransitioning}
          onValueChange={(selectedValue) => {
            if (typeof selectedValue === 'string') {
              onPageSizeChange(Number(selectedValue));
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="ml-1 w-28"
            aria-label="每页条数"
          >
            <span>{pageSize} 条/页</span>
          </SelectTrigger>
          <SelectContent>
            {[10, 20, 50, 100].map((pageSizeOption) => (
              <SelectItem key={pageSizeOption} value={String(pageSizeOption)}>
                {pageSizeOption} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form className="ml-1 flex items-center gap-1.5" onSubmit={jumpToPage}>
          <span className="whitespace-nowrap">跳至</span>
          <Input
            className="w-16 text-center"
            type="number"
            min={1}
            max={totalPages}
            value={jumpPage}
            disabled={isPageTransitioning}
            aria-label="跳转页码"
            onChange={(changeEvent) => setJumpPage(changeEvent.target.value)}
          />
          <span>页</span>
        </form>
      </div>
    </div>
  );
}
