import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdateAccessTokenDto {
  @ApiProperty({
    required: false,
    description: '更新后的完整功能组名称列表。',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  projects?: string[];

  @ApiProperty({
    required: false,
    nullable: true,
    description: '新的绝对过期时间；null 表示取消时间限制。',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    minimum: 1,
    maximum: 2147483647,
    description: '新的最大 RPC 调用次数；null 表示取消次数限制。',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  maximumUsageCount?: number | null;
}
