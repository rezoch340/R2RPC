import { Global, Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { AccessTokenService } from './access-token.service';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';
import { AccessTokenController } from './access-token.controller';

// 全局模块:AccessTokenGuard 需在 /rpc/invoke、/rpc/clientQueue 等路由上按需应用(3.4),
// 全局导出便于各处直接注入而无需重复 import ProjectsModule/RedisModule
@Global()
@Module({
  imports: [ProjectsModule],
  controllers: [AccessTokenController],
  providers: [AccessTokenService, AccessTokenGuard],
  exports: [AccessTokenService, AccessTokenGuard],
})
export class AccessTokenModule {}
