import { sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import { pageBounds } from './page-bounds';

type Database = NodePgDatabase<Record<string, never>>;

export interface PaginatedResult<Row> {
  rows: Row[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * 列表分页信封:夹取页码、统计总数、装 { rows, page, pageSize, total }。
 * 行查询交给 fetchRows 回调——投影、排序和取回后的加工各表都不一样,
 * 硬塞进公共件要靠重型泛型换很少的收益,不划算。
 * whereClause 必须与行查询用同一个,否则 total 和 rows 对不上。
 */
export async function paginate<Row>(
  database: Database,
  table: PgTable,
  whereClause: SQL | undefined,
  query: { page?: number; pageSize?: number },
  fetchRows: (limit: number, offset: number) => Promise<Row[]>,
): Promise<PaginatedResult<Row>> {
  const { page, pageSize, offset } = pageBounds(query);
  const [countRow] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(table)
    .where(whereClause);
  const rows = await fetchRows(pageSize, offset);
  return { rows, page, pageSize, total: countRow?.total ?? 0 };
}
