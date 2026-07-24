import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../../common/decorators/authenticated-only.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SystemAudit } from '../../common/decorators/system-audit.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @SystemAudit({
    name: '登录系统',
    action: 'login',
    subject: 'auth',
    targetType: 'user',
    actorUsernameBodyField: 'username',
    actorUserIdResponsePath: 'user.id',
    actorUsernameResponsePath: 'user.username',
  })
  @ApiOperation({ summary: '管理员登录,返回 JWT' })
  login(@Body() input: LoginDto) {
    return this.auth.login(input.username, input.password);
  }

  @Get('me')
  @ApiBearerAuth('adminJwt')
  @AuthenticatedOnly()
  @ApiOperation({ summary: '当前登录用户' })
  me(@Req() request: { user: unknown }) {
    return request.user;
  }
}
