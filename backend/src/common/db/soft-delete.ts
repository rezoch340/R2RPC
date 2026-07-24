import { and, isNull, SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';

// 软删表的最小约束:有可空 deletedAt 列
type SoftTable = PgTable & { deletedAt: PgColumn };

/**
 * 「存活」条件:isNull(deletedAt) AND 其余条件。
 * 所有针对软删表的读查询,.where() 一律经此;join 的 ON 条件也可用它,
 * 一并过滤掉被软删的父行(父表软删不 cascade 关联行,靠这里兜可见性)。
 */
export function alive<T extends SoftTable>(
  table: T,
  ...conditions: (SQL | undefined)[]
): SQL {
  return and(isNull(table.deletedAt), ...conditions) as SQL;
}

/**
 * 软删除:UPDATE ... SET deleted_at = now() WHERE alive(table, where)。
 * 只命中未删行(重复删返回空数组),.returning() 便于校验 NotFound / 拿行删缓存。
 * ponytail: 泛型 update().set() 拿不到 deletedAt 静态类型,此处 as any 是有意的边界转型;
 *           正确性由 build + smoke 兜底。
 */
export function softDelete<T extends SoftTable>(
  database: NodePgDatabase,
  table: T,
  where: SQL,
): Promise<Record<string, any>[]> {
  return (
    database
      .update(table)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- 泛型 set() 拿不到 deletedAt 静态类型,边界转型
      .set({ deletedAt: new Date() } as any)
      .where(alive(table, where))
      .returning() as unknown as Promise<Record<string, any>[]>
  );
}
