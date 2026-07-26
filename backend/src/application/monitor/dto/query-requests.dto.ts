import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// 请求记录列表查询(全为可选过滤)
export class QueryRequestsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() project?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clientId?: string;
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
  @ApiPropertyOptional({ description: 'ISO 起始时间' })
  @IsOptional()
  @IsString()
  from?: string;
  @ApiPropertyOptional({ description: 'ISO 结束时间' })
  @IsOptional()
  @IsString()
  to?: string;
}
