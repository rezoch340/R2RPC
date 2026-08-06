'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { buildQueryString, requestApi } from '@/lib/api-client';
import type { PaginatedResponse } from '@/lib/models';
import { refreshTableData, useTableQuery } from '@/lib/table-query';
import { useFilterState, type FilterState } from '@/lib/use-filter-state';

const DEFAULT_PAGE_SIZE = 10;

// datetime-local 输入框给的是本地时间字符串，后端按 ISO 解析。
// 带时间范围的列表页都要这一步，直接作为 transformFilters 传入。
export function toIsoDateRange<Filters extends { from?: string; to?: string }>(
  filters: Filters,
): Record<string, unknown> {
  return {
    ...filters,
    from: filters.from ? new Date(filters.from).toISOString() : undefined,
    to: filters.to ? new Date(filters.to).toISOString() : undefined,
  };
}

// 服务端分页列表页的整套接线:筛选状态、页码、查询串、请求、以及 FilterBar 与
// DataTable/Pagination 的 props。此前每个列表页都抄一遍这四十多行,只有端点和列定义不同。
export interface ServerTable<Row, Filters> {
  filters: FilterState<Filters>;
  rows: Row[];
  isLoading: boolean;
  isError: boolean;
  // 直接摊给 <FilterBar {...filterBarProps} />,fields 仍由各页自己传
  filterBarProps: {
    values: Filters;
    onChange: (key: keyof Filters, value: string) => void;
    onSubmit: () => void;
    onReset: () => void;
  };
  // 直接摊给 <DataTable {...tableProps} />,columns 与 emptyMessage 由各页自己传
  tableProps: {
    rows: Row[];
    isLoading: boolean;
    transitionKey: string;
    transitionDirection: 'forward' | 'backward';
  };
  paginationProps: {
    page: number;
    pageSize: number;
    total: number;
    isPageTransitioning: boolean;
    onPageChange: (page: number) => void;
    onPageSizeChange: (pageSize: number) => void;
  };
}

export function useServerTable<Row, Filters extends object>({
  resourceKey,
  endpoint,
  emptyFilters,
  transformFilters,
}: {
  // 同时作为 react-query 的 key 前缀和重置时的刷新目标
  resourceKey: string;
  endpoint: string;
  emptyFilters: Filters;
  // 少数页面需要在拼查询串前改写筛选值(如把本地时间转 ISO)
  transformFilters?: (filters: Filters) => Record<string, unknown>;
}): ServerTable<Row, Filters> {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // 翻页方向:往后翻表体从右侧进,往回翻从左侧进
  const [transitionDirection, setTransitionDirection] = useState<
    'forward' | 'backward'
  >('forward');
  const queryClient = useQueryClient();
  const filters = useFilterState(emptyFilters, {
    onApply: () => {
      setTransitionDirection('forward');
      setPage(1);
    },
    onReset: () => {
      setTransitionDirection('forward');
      setPage(1);
      void refreshTableData(queryClient, [resourceKey]);
    },
  });

  const queryString = buildQueryString({
    ...(transformFilters ? transformFilters(filters.applied) : filters.applied),
    page,
    pageSize,
  });
  const tableQuery = useTableQuery({
    queryKey: [resourceKey, filters.applied, page, pageSize],
    queryFunction: () =>
      requestApi<PaginatedResponse<Row>>(`${endpoint}${queryString}`),
  });

  const rows = tableQuery.data?.rows ?? [];
  const resolvedPage = tableQuery.data?.page ?? page;

  return {
    filters,
    rows,
    isLoading: tableQuery.isLoading,
    isError: tableQuery.isError,
    filterBarProps: {
      values: filters.draft,
      onChange: filters.update,
      onSubmit: filters.apply,
      onReset: filters.reset,
    },
    tableProps: {
      rows,
      isLoading: tableQuery.isLoading,
      // 只在真正切页或换筛选时变;后台轮询拿到同一页不会重放动画
      transitionKey: `${resolvedPage}-${JSON.stringify(filters.applied)}`,
      transitionDirection,
    },
    paginationProps: {
      page: tableQuery.data?.page ?? page,
      pageSize: tableQuery.data?.pageSize ?? pageSize,
      total: tableQuery.data?.total ?? 0,
      isPageTransitioning: tableQuery.isPlaceholderData,
      onPageChange: (nextPage: number) => {
        // 方向在点击那一刻就定了,不必等数据回来再比对
        setTransitionDirection(nextPage >= page ? 'forward' : 'backward');
        setPage(nextPage);
      },
      onPageSizeChange: (newPageSize: number) => {
        setPageSize(newPageSize);
        setPage(1);
      },
    },
  };
}
