import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class AssignRoleDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  roleId: number;
}
