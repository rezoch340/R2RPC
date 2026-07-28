import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

// 两类令牌列表共用的查询参数:字段与筛选语义完全一致,只有底层表不同。
export class QueryTokensDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '令牌数据库编号精确匹配' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  id?: number;

  @ApiPropertyOptional({ description: '令牌名称模糊匹配' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '所挂功能组名称,完整名等值匹配' })
  @IsOptional()
  @IsString()
  project?: string;

  @ApiPropertyOptional({ enum: ['active', 'revoked'] })
  @IsOptional()
  @IsIn(['active', 'revoked'])
  status?: 'active' | 'revoked';
}
