import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// worker 进程入口:BullMQ 消费者 / 定时维护任务,不起 HTTP
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('worker 进程已启动(BullMQ 消费者 / 定时任务)', 'Worker');
}
bootstrap();
