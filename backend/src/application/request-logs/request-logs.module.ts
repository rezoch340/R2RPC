import { Module } from '@nestjs/common';
import { RequestLogsController } from './request-logs.controller';
import { RequestLogsService } from './request-logs.service';

@Module({
  controllers: [RequestLogsController],
  providers: [RequestLogsService]
})
export class RequestLogsModule {}
