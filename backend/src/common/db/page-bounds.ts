const DEFAULT_PAGE_SIZE = 10;
const MAXIMUM_PAGE_SIZE = 100;
// 与 PaginationQueryDto 的上界一致:防止 (page-1)*pageSize 溢出 bigint 把 OFFSET 打崩
const MAXIMUM_PAGE = 1_000_000;

interface PaginationInput {
  page?: number;
  pageSize?: number;
}

/**
 * 列表分页夹取:page 至少 1,pageSize 落在 [1,100] 且默认 10。
 * DTO 校验已经挡掉越界值,这里是服务层的兜底(内部调用方可以不经 DTO)。
 * 返回的 offset 直接喂给 drizzle `.offset()`。
 */
export function pageBounds(query: PaginationInput) {
  const page = Math.min(MAXIMUM_PAGE, Math.max(1, query.page ?? 1));
  const pageSize = Math.min(
    MAXIMUM_PAGE_SIZE,
    Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}
