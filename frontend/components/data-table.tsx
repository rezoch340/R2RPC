import type { ReactNode } from 'react';
import { TableLoadingState, EmptyTableState } from '@/components/query-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { combineClassNames } from '@/lib/utils';

export interface DataTableColumn<RowType> {
  key: string;
  header: string;
  render: (row: RowType) => ReactNode;
  className?: string;
}

export function DataTable<RowType>({
  columns,
  rows,
  isLoading = false,
  emptyMessage,
  rowKey,
  footer,
  tableClassName,
  transitionKey,
  transitionDirection = 'forward',
}: {
  columns: Array<DataTableColumn<RowType>>;
  rows: RowType[];
  isLoading?: boolean;
  emptyMessage?: string;
  rowKey: (row: RowType) => string | number;
  footer?: ReactNode;
  tableClassName?: string;
  // 变化即重挂表体、重放入场动画。只在真正切页/换筛选时变，
  // 15 秒的后台轮询拿到同一页不会触发，避免表格自己闪
  transitionKey?: string | number;
  transitionDirection?: 'forward' | 'backward';
}) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <Table className={tableClassName}>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={combineClassNames(
                  'whitespace-nowrap text-xs font-semibold text-muted-foreground',
                  column.className,
                )}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody
          key={transitionKey}
          className={combineClassNames(
            'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-safe:ease-out',
            // 往后翻从右侧进,往回翻从左侧进,方向跟翻页一致
            transitionDirection === 'backward'
              ? 'motion-safe:slide-in-from-left-6'
              : 'motion-safe:slide-in-from-right-6',
          )}
        >
          {isLoading ? (
            <TableLoadingState columns={columns.length} />
          ) : rows.length === 0 ? (
            <EmptyTableState columns={columns.length} message={emptyMessage} />
          ) : (
            rows.map((row) => (
              <TableRow key={rowKey(row)} className="even:bg-muted/[0.14]">
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {footer ? (
        <div className="border-t bg-card px-4 py-3">{footer}</div>
      ) : null}
    </div>
  );
}
