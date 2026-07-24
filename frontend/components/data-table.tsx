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
}: {
  columns: Array<DataTableColumn<RowType>>;
  rows: RowType[];
  isLoading?: boolean;
  emptyMessage?: string;
  rowKey: (row: RowType) => string | number;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/55 hover:bg-muted/55">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={combineClassNames(
                    'whitespace-nowrap font-mono text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase',
                    column.className,
                  )}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableLoadingState columns={columns.length} />
            ) : rows.length === 0 ? (
              <EmptyTableState
                columns={columns.length}
                message={emptyMessage}
              />
            ) : (
              rows.map((row) => (
                <TableRow key={rowKey(row)}>
                  {columns.map((column) => (
                    <TableCell
                      key={column.key}
                      className={column.className}
                    >
                      {column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
