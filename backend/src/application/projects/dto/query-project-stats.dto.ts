import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsInt } from 'class-validator';

// 一次最多问一页的量:列表页 pageSize 上限就是 100,再多说明调用方用法不对
const MAXIMUM_STATS_IDS = 100;

export class QueryProjectStatsDto {
  @ApiProperty({
    type: String,
    description: '功能组编号,逗号分隔,例如 1,2,3',
    example: '1,2,3',
  })
  // 查询串里是 "1,2,3";拆开逐个转数字,非法项留成 NaN 交给 IsInt 拒绝
  @Transform(({ value }): unknown => {
    if (typeof value !== 'string') {
      return value;
    }
    return value
      .split(',')
      .filter((segment) => segment.trim() !== '')
      .map((segment) => Number(segment));
  })
  @ArrayNotEmpty()
  @ArrayMaxSize(MAXIMUM_STATS_IDS)
  @IsInt({ each: true })
  ids!: number[];
}
