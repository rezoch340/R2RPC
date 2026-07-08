import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '../config/config.service';
import { ClusterBus } from './cluster-bus.service';
import { ConnectionRegistry } from './connection.registry';
import { PresenceService } from './presence.service';
import { WsGateway } from './ws.gateway';

@Module({
  imports: [
    // 网关用 JwtService 校验手机端 token(只需 secret)
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({ secret: cfg.jwt.secret }),
    }),
  ],
  providers: [WsGateway, PresenceService, ConnectionRegistry, ClusterBus],
  exports: [PresenceService, ConnectionRegistry],
})
export class WsModule {}
