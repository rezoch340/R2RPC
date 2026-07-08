import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsObject, IsOptional, Min } from 'class-validator';

// RPC 调用负载(扁平结构)
export class InvokeDto {
  @ApiPropertyOptional({ description: '超时秒数', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutSeconds?: number;

  // @IsObject 既做校验也让全局 ValidationPipe(whitelist)放行,否则 payload 会被剥掉
  @ApiProperty({ description: '调用负载(扁平对象)' })
  @IsObject()
  payload: Record<string, unknown>;
}
