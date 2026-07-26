import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// page 上界:再大也不可能有对应数据,而 (page-1)*pageSize 一旦超出 PostgreSQL bigint
// 就会让 OFFSET 抛数据库错误、六个分页接口一起 500。取一百万页,留足余量的同时把溢出挡在 DTO。
const MAXIMUM_PAGE = 1_000_000;
const MAXIMUM_PAGE_SIZE = 100;

// 列表分页公共查询参数:默认 10 条/页、上限 100 条/页。各列表查询 DTO 继承它,不再各写一份。
export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAXIMUM_PAGE,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAXIMUM_PAGE)
  page?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAXIMUM_PAGE_SIZE,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAXIMUM_PAGE_SIZE)
  pageSize?: number;
}
