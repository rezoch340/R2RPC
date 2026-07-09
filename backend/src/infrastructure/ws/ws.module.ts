import { Module } from '@nestjs/common';
import { DeviceTokenModule } from '../../application/device-token/device-token.module';
import { DevicesModule } from '../../application/devices/devices.module';
import { ClusterBus } from './cluster-bus.service';
import { ConnectionRegistry } from './connection.registry';
import { PresenceService } from './presence.service';
import { WsGateway } from './ws.gateway';

@Module({
  imports: [DeviceTokenModule, DevicesModule],
  providers: [WsGateway, PresenceService, ConnectionRegistry, ClusterBus],
  exports: [PresenceService, ConnectionRegistry],
})
export class WsModule {}
