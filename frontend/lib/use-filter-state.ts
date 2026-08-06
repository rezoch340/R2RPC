'use client';

import { useState } from 'react';

// 每个列表页都重复这一套:草稿筛选、已应用筛选、逐字段更新、查询回第一页、重置回空值。
// FilterBar 只管渲染,这里收掉它外面那圈状态。
export interface FilterState<Filters> {
  draft: Filters;
  applied: Filters;
  update: (key: keyof Filters, value: string) => void;
  apply: () => void;
  reset: () => void;
}

// 约束用 object 而非 Record<string, string>:各页的筛选是 interface,没有索引签名,收不进后者
// onApply / onReset 留给各页做分页归位和强制刷新——这两件事各页不完全一样,不塞进公共实现
export function useFilterState<Filters extends object>(
  emptyFilters: Filters,
  callbacks: { onApply?: () => void; onReset?: () => void } = {},
): FilterState<Filters> {
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);

  return {
    draft,
    applied,
    update: (key, value) =>
      setDraft((currentFilters) => ({ ...currentFilters, [key]: value })),
    apply: () => {
      setApplied(draft);
      callbacks.onApply?.();
    },
    reset: () => {
      setDraft(emptyFilters);
      setApplied(emptyFilters);
      callbacks.onReset?.();
    },
  };
}
