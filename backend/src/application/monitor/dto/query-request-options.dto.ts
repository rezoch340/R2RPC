import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// 请求筛选下拉选项查询(联动过滤:传了哪维就按它约束其余维,全为可选)
export class QueryRequestOptionsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() project?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clientId?: string;
}
