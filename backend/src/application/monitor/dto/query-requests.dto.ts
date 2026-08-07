import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// 请求记录列表查询(全为可选过滤)
export class QueryRequestsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() project?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clientId?: string;

  @ApiPropertyOptional({ description: '调用方业务单号,精确匹配' })
  @IsOptional()
  @IsString()
  clientRequestId?: string;
  @ApiPropertyOptional({ description: 'Access Token 数据库编号精确匹配' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  accessTokenId?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() payloadState?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumLatencyMs?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maximumLatencyMs?: number;
  // 与 QuerySystemLogsDto 一致用 IsDateString:只 IsString 的话非法日期会变成 Invalid Date
  // 一路传到 drizzle,由 pg 驱动抛错成 500
  @ApiPropertyOptional({ description: 'ISO 起始时间' })
  @IsOptional()
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({ description: 'ISO 结束时间' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
