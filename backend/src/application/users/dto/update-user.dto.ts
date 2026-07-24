import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  description: string;
}
