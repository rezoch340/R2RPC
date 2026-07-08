import { Global, Module } from '@nestjs/common';
import { RbacService } from './rbac.service';

// 全局模块:RbacService 需被 AuthModule(JwtStrategy)和全局 PermissionGuard 注入,
// 用 @Global 避免各处重复 import
@Global()
@Module({
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
