import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryDevicesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '设备编号模糊匹配' })
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ description: '平台模糊匹配' })
  @IsOptional()
  @IsString()
  platform?: string;

  @ApiPropertyOptional({ description: '最后 IP 模糊匹配' })
  @IsOptional()
  @IsString()
  lastIp?: string;

  @ApiPropertyOptional({ enum: ['online', 'offline', 'stale'] })
  @IsOptional()
  @IsIn(['online', 'offline', 'stale'])
  status?: 'online' | 'offline' | 'stale';
}
