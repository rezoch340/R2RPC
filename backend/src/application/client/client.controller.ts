import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ClientService } from './client.service';
import { ClientLoginDto } from './dto/client-login.dto';
import { CreateClientDto } from './dto/create-client.dto';

@ApiTags('client')
@Controller()
export class ClientController {
  constructor(private readonly client: ClientService) {}

  // 手机端登录(无需 JWT),返回 token 与 wsUrl
  @Public()
  @Post('api/client/login')
  @ApiOperation({ summary: '手机设备登录,返回 token 与 wsUrl' })
  login(@Body() dto: ClientLoginDto) {
    return this.client.login(dto.clientId, dto.group, dto.secret);
  }

  // 管理端:创建设备账号
  @Roles('admin')
  @ApiBearerAuth()
  @Post('clients')
  @ApiOperation({ summary: '创建手机设备账号' })
  create(@Body() dto: CreateClientDto) {
    return this.client.createAccount(dto);
  }

  @Roles('admin')
  @ApiBearerAuth()
  @Get('clients')
  @ApiOperation({ summary: '设备账号列表' })
  list() {
    return this.client.list();
  }
}
