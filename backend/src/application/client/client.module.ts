import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupsModule } from '../groups/groups.module';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';

@Module({
  // 复用 AuthModule 导出的 JwtModule 签发 client JWT;GroupsModule 提供设备分组查询
  imports: [AuthModule, GroupsModule],
  controllers: [ClientController],
  providers: [ClientService],
  exports: [ClientService],
})
export class ClientModule {}
