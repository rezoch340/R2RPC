import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

// 手机端登录
export class ClientLoginDto {
  @ApiProperty()
  @IsString()
  clientId: string;

  @ApiProperty()
  @IsString()
  secret: string;
}
