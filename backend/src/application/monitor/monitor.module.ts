import { Module } from '@nestjs/common';
import { RequestLogsModule } from '../request-logs/request-logs.module';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';

@Module({
  // RequestLogsModule 提供 PG 脊柱查询;SearchService 走全局 SearchModule
  imports: [RequestLogsModule],
  controllers: [MonitorController],
  providers: [MonitorService],
})
export class MonitorModule {}
