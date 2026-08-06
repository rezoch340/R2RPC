import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryPermissionGroupsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '权限组名称模糊匹配' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    description: '所含权限模糊匹配,匹配 action 或 subject',
  })
  @IsOptional()
  @IsString()
  permission?: string;
}

export class QueryPermissionsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '动作模糊匹配' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: '资源模糊匹配' })
  @IsOptional()
  @IsString()
  subject?: string;
}
