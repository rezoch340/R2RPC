import { Global, Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { AccessTokenService } from './access-token.service';
import { AccessTokenGuard } from '../../common/guards/access-token.guard';

// 全局模块:AccessTokenGuard 需在 /rpc/invoke、/rpc/clientQueue 等路由上按需应用(3.4),
// 全局导出便于各处直接注入而无需重复 import GroupsModule/RedisModule
@Global()
@Module({
  imports: [GroupsModule],
  providers: [AccessTokenService, AccessTokenGuard],
  exports: [AccessTokenService, AccessTokenGuard],
})
export class AccessTokenModule {}
