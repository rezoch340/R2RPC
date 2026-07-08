import { Module } from '@nestjs/common';
import { AuthModule } from './application/auth/auth.module';
import { UsersModule } from './application/users/users.module';
import { GroupsModule } from './application/groups/groups.module';
import { DevicesModule } from './application/devices/devices.module';
import { ClientModule } from './application/client/client.module';
import { RpcModule } from './application/rpc/rpc.module';
import { MonitorModule } from './application/monitor/monitor.module';
import { MetricsModule } from './application/metrics/metrics.module';
import { RequestLogsModule } from './application/request-logs/request-logs.module';
import { ConfigModule } from './infrastructure/config/config.module';
import { DbModule } from './infrastructure/db/db.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { SearchModule } from './infrastructure/search/search.module';
import { WsModule } from './infrastructure/ws/ws.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    QueueModule,
    SearchModule,
    WsModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    DevicesModule,
    ClientModule,
    RpcModule,
    MonitorModule,
    MetricsModule,
    RequestLogsModule,
  ],
})
export class AppModule {}
