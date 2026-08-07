'use client';

import { CopyButton } from '@/components/copy-button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// 首尾各留几位，中间打星
const VISIBLE_EDGE_LENGTH = 4;
// 10 位以内本来就看得全，不必打码；再短还会出现星号比原文长的情况
const MINIMUM_MASK_LENGTH = 11;
const OVERFLOW_MARK = '****';

export function maskIdentifier(value: string): string {
  if (value.length < MINIMUM_MASK_LENGTH) {
    return value;
  }
  const head = value.slice(0, VISIBLE_EDGE_LENGTH);
  const tail = value.slice(-VISIBLE_EDGE_LENGTH);
  return `${head}${OVERFLOW_MARK}${tail}`;
}

// 长编号的列内展示：悬停看完整值 + 一键复制。
// variant='mask' 固定首尾四位打码，适合窄列；'fit' 按列宽尽量多显示，放不下的截断成省略号。
export function MaskedIdentifier({
  value,
  label,
  emptyText = '未分配',
  successMessage,
  variant = 'mask',
}: {
  value: string | null | undefined;
  label: string;
  emptyText?: string;
  successMessage?: string;
  variant?: 'mask' | 'fit';
}) {
  if (!value) {
    return <span className="text-xs text-muted-foreground">{emptyText}</span>;
  }
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 flex-1 cursor-default">
              {variant === 'fit' ? (
                // 能放多少放多少,放不下的用省略号顶掉。Chrome 不支持
                // text-overflow 的字符串语法,自定义符号只能靠 JS 量宽度,不值当。
                // max-w 是必需的:表格 auto layout 会按内容撑宽列,不封顶就变成整表横向滚动
                <code className="block min-w-0 max-w-[24ch] truncate font-mono text-xs">
                  {value}
                </code>
              ) : (
                <code className="font-mono text-xs">
                  {maskIdentifier(value)}
                </code>
              )}
            </span>
          }
        />
        <TooltipContent>{value}</TooltipContent>
      </Tooltip>
      <CopyButton value={value} label={label} successMessage={successMessage} />
    </span>
  );
}
