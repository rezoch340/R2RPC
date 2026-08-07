import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// RPC 调用负载(扁平结构)
export class InvokeDto {
  @ApiPropertyOptional({ description: '超时秒数', default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutSeconds?: number;

  // 调用方自带的业务单号,只用于日志检索。服务端不拿它做路由或去重——
  // 那些仍由内部生成的 requestId 独占,避免外部值造成结果串台或审计被吞
  @ApiPropertyOptional({
    description: '调用方业务单号,仅供请求日志检索;不参与路由与去重',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientRequestId?: string;

  // @IsObject 既做校验也让全局 ValidationPipe(whitelist)放行,否则 payload 会被剥掉
  @ApiProperty({ description: '调用负载(扁平对象)' })
  @IsObject()
  payload: Record<string, unknown>;
}
