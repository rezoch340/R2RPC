'use client';

import { useMemo, useState } from 'react';

export function useClientPagination<RowType>(
  rows: RowType[],
  initialPageSize = 10,
) {
  const [requestedPage, setRequestedPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const pageRows = useMemo(() => {
    const firstRowIndex = (page - 1) * pageSize;
    return rows.slice(firstRowIndex, firstRowIndex + pageSize);
  }, [page, pageSize, rows]);

  function setPageSize(nextPageSize: number) {
    setPageSizeState(nextPageSize);
    setRequestedPage(1);
  }

  return {
    page,
    pageSize,
    pageRows,
    total: rows.length,
    setPage: setRequestedPage,
    setPageSize,
    resetPage: () => setRequestedPage(1),
  };
}
