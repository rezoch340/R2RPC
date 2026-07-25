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

export class CreateAccessTokenDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  projects: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 2147483647,
    description: '可选最大 RPC 调用次数；达到后令牌失效。',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  maximumUsageCount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;
}
