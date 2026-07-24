import { Global, Module } from '@nestjs/common';
import { RootGuard } from '../../common/guards/root.guard';
import { UsersModule } from '../users/users.module';
import { RbacService } from './rbac.service';
import { RbacController } from './rbac.controller';

// 全局模块:RbacService 需被 AuthModule(JwtStrategy)和全局 PermissionGuard 注入,
// 用 @Global 避免各处重复 import
@Global()
@Module({
  imports: [UsersModule],
  controllers: [RbacController],
  providers: [RbacService, RootGuard],
  exports: [RbacService],
})
export class RbacModule {}
