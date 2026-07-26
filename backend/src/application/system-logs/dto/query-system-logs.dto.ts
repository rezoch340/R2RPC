import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QuerySystemLogsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorUsername?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetName?: string;

  @ApiPropertyOptional({ enum: ['succeeded', 'failed'] })
  @IsOptional()
  @IsIn(['succeeded', 'failed'])
  status?: 'succeeded' | 'failed';

  @ApiPropertyOptional({ description: 'ISO 起始时间' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO 结束时间' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
