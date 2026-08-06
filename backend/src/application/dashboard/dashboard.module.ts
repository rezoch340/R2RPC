import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { MetricsModule } from '../metrics/metrics.module';
import { ProjectsModule } from '../projects/projects.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [ProjectsModule, DevicesModule, MetricsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
