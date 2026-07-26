import { BadRequestException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// 对象嵌套扫描深度上限:请求参数不会有这么深,超过即认为无需继续下探
const MAXIMUM_SCAN_DEPTH = 8;

// PostgreSQL 的 text 类型不接受 NUL 字节。带 \0 的查询参数或请求体会一路穿过 DTO 校验
// (IsString 认为它合法)打到 pg 驱动才抛错,表现为 500。在入口统一挡掉,变成明确的 400。
function containsNullByte(value: unknown, depth = 0): boolean {
  if (depth > MAXIMUM_SCAN_DEPTH) {
    return false;
  }
  if (typeof value === 'string') {
    return value.includes('\u0000');
  }
  if (Array.isArray(value)) {
    return value.some((element) => containsNullByte(element, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((element) =>
      containsNullByte(element, depth + 1),
    );
  }
  return false;
}

export function rejectNullByte(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (containsNullByte(request.query) || containsNullByte(request.body)) {
    throw new BadRequestException('请求参数不得包含 NUL 字节');
  }
  next();
}
