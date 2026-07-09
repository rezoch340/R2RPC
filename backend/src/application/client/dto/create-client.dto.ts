import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, MinLength } from 'class-validator';

export class CreateClientDto {
  @ApiProperty()
  @IsString()
  clientId: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  projects: string[];

  @ApiProperty()
  @IsString()
  @MinLength(6)
  secret: string;
}
