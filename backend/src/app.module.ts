import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SystemAuditInterceptor } from './common/interceptors/system-audit.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { AuthModule } from './application/auth/auth.module';
import { UsersModule } from './application/users/users.module';
import { ProjectsModule } from './application/projects/projects.module';
import { AccessTokenModule } from './application/access-token/access-token.module';
import { DeviceTokenModule } from './application/device-token/device-token.module';
import { DevicesModule } from './application/devices/devices.module';
import { RpcModule } from './application/rpc/rpc.module';
import { MonitorModule } from './application/monitor/monitor.module';
import { MetricsModule } from './application/metrics/metrics.module';
import { RequestLogsModule } from './application/request-logs/request-logs.module';
import { RbacModule } from './application/rbac/rbac.module';
import { ConfigModule } from './infrastructure/config/config.module';
import { DbModule } from './infrastructure/db/db.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { SearchModule } from './infrastructure/search/search.module';
import { WsModule } from './infrastructure/ws/ws.module';
import { SystemLogsModule } from './application/system-logs/system-logs.module';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    RedisModule,
    QueueModule,
    SearchModule,
    WsModule,
    RbacModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    AccessTokenModule,
    DeviceTokenModule,
    DevicesModule,
    RpcModule,
    MonitorModule,
    MetricsModule,
    RequestLogsModule,
    SystemLogsModule,
  ],
  providers: [
    // 全局鉴权:先 JWT(@Public 跳过),再 Permission(@RequirePermission 校验,fail-closed)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: SystemAuditInterceptor },
  ],
})
export class AppModule {}
