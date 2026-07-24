import { AlertCircle, Inbox } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export function TableLoadingState({ columns }: { columns: number }) {
  const rowIndexes = Array.from(Array(5).keys());
  const columnIndexes = Array.from(Array(columns).keys());
  return rowIndexes.map((rowIndex) => (
    <tr key={`loading-row-${rowIndex}`} className="border-b last:border-0">
      {columnIndexes.map((columnIndex) => (
        <td key={`loading-cell-${columnIndex}`} className="p-4">
          <Skeleton className="h-4 w-full max-w-36" />
        </td>
      ))}
    </tr>
  ));
}

export function EmptyTableState({
  columns,
  message = '暂无数据',
}: {
  columns: number;
  message?: string;
}) {
  return (
    <tr>
      <td colSpan={columns} className="h-36 text-center">
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="size-4" />
          {message}
        </span>
      </td>
    </tr>
  );
}

export function QueryErrorState({ message }: { message?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0" />
      {message ?? '数据加载失败，请稍后重试'}
    </div>
  );
}
