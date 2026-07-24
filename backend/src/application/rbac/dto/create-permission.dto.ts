import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePermissionDto {
  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  action: string;

  @ApiProperty({ minLength: 1, maxLength: 64 })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  subject: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}
