import { eq, gte, ilike, lte, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { containsPattern } from './like-pattern';

/**
 * 筛选条件小工具:值缺省就不产生条件。
 * 各 service 的 buildConditions 原本都在写「if (query.x) conditions.push(...)」,
 * 用这几个之后只剩「哪个字段配哪种匹配」的声明。
 */

// 模糊匹配(ILIKE 包含),空串按未填处理——筛选框清空后不该退化成全表 LIKE '%%'
export function likeIf(column: PgColumn, value?: string | null): SQL | null {
  if (!value) {
    return null;
  }
  return ilike(column, containsPattern(value));
}

// 精确匹配;0 和 false 是有效值,只跳过 null/undefined/空串
export function eqIf<Value>(
  column: PgColumn,
  value?: Value | null,
): SQL | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return eq(column, value);
}

// 时间下界/上界:筛选框传的是字符串,统一在这里转 Date
export function gteIf(column: PgColumn, value?: string | null): SQL | null {
  if (!value) {
    return null;
  }
  return gte(column, new Date(value));
}

export function lteIf(column: PgColumn, value?: string | null): SQL | null {
  if (!value) {
    return null;
  }
  return lte(column, new Date(value));
}

// 丢掉未产生条件的项,交给 alive()/and() 拼接
export function compactConditions(
  ...conditions: Array<SQL | null | undefined>
): SQL[] {
  return conditions.filter((condition): condition is SQL => Boolean(condition));
}
