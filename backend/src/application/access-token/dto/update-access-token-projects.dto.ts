import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class UpdateAccessTokenProjectsDto {
  @ApiProperty({
    description: '更新后的完整功能组名称列表',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  projects: string[];
}
