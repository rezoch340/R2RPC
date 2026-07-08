import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Min } from 'class-validator';

// RPC 调用负载(扁平结构)
export class InvokeDto {
  @ApiPropertyOptional({ description: '超时秒数', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutSeconds?: number;

  @ApiProperty({ description: '调用负载' })
  payload: Record<string, unknown>;
}
