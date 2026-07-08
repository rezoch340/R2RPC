import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

// worker 进程入口:BullMQ 消费者 + 定时维护任务,不起 HTTP。
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('worker 进程已启动(请求日志消费 + 死信补偿 + repair)', 'Worker');
}
void bootstrap();
