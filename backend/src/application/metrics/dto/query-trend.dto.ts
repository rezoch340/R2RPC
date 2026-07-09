import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryTrendDto {
  @ApiPropertyOptional({ default: 7, description: '天数,1-90' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;

  @ApiPropertyOptional({ description: '按 project 过滤' })
  @IsOptional()
  @IsString()
  project?: string;
}
