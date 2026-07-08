import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ConfigService } from './infrastructure/config/config.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// API 进程入口:HTTP API + WebSocket Gateway + Swagger
async function bootstrap() {
  // 全局兜底:WS 网关等处若仍有漏网的悬空 Promise(如 redis 抖动),不能让进程直接崩掉
  process.on('unhandledRejection', (reason) => {
    new Logger('Process').error(
      `未处理的 Promise 拒绝: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  });

  const app = await NestFactory.create(AppModule);
  const cfg = app.get(ConfigService);

  if (cfg.app.globalPrefix) app.setGlobalPrefix(cfg.app.globalPrefix);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const swaggerCfg = new DocumentBuilder()
    .setTitle('RER0RPC API')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerCfg));

  await app.listen(cfg.app.port);
}
bootstrap();
