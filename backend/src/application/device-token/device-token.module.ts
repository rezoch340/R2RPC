import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { DeviceTokenController } from './device-token.controller';
import { DeviceTokenService } from './device-token.service';

@Module({
  imports: [ProjectsModule],
  controllers: [DeviceTokenController],
  providers: [DeviceTokenService],
  exports: [DeviceTokenService],
})
export class DeviceTokenModule {}
