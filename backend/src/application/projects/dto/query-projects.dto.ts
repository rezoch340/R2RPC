import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

// 运行态由设备聚合派生,不是库里的列;取值口径与 SQL 里的 CASE 分支一一对应
export const PROJECT_STATUSES = [
  'online',
  'offline',
  'stale',
  'no_device',
  'disabled',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export class QueryProjectsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '功能组名称模糊匹配' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    enum: PROJECT_STATUSES,
    description: '运行态;派生自设备聚合,筛选与分页在同一条查询内完成',
  })
  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: ProjectStatus;

  @ApiPropertyOptional({
    enum: ['enabled', 'disabled'],
    description: '启用状态',
  })
  @IsOptional()
  @IsIn(['enabled', 'disabled'])
  enabled?: 'enabled' | 'disabled';
}
