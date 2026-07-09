import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';

@Module({
  // 复用 AuthModule 导出的 JwtModule 签发 client JWT;ProjectsModule 提供设备 project 查询
  imports: [AuthModule, ProjectsModule],
  controllers: [ClientController],
  providers: [ClientService],
  exports: [ClientService],
})
export class ClientModule {}
