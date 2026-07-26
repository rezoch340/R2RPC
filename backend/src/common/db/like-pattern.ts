/**
 * 包含匹配模式:转义用户输入里的 ILIKE 通配符,让 % 和 _ 按字面量参与匹配。
 * PostgreSQL 的 ILIKE 默认以反斜杠为转义字符,所以反斜杠本身也要转义。
 */
export function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}
