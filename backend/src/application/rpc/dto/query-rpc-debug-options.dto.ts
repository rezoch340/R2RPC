import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class QueryRpcDebugOptionsDto {
  @ApiPropertyOptional({
    description: '用于加载历史 action 和在线设备的功能组',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  project?: string;
}
