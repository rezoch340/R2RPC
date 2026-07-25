import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildOpenApiConfiguration } from './common/openapi/openapi.configuration';
import { completeOpenApiDocument } from './common/openapi/openapi.document';
import { ConfigService } from './infrastructure/config/config.service';

// API 进程入口:HTTP API + WebSocket Gateway + 可选 Swagger
async function bootstrap() {
  // 全局兜底:WS 网关等处若仍有漏网的悬空 Promise(如 redis 抖动),不能让进程直接崩掉
  process.on('unhandledRejection', (reason) => {
    new Logger('Process').error(
      `未处理的 Promise 拒绝: ${reason instanceof Error ? reason.message : String(reason)}`,
    );
  });

  const application = await NestFactory.create(AppModule);
  const configuration = application.get(ConfigService);

  if (configuration.app.globalPrefix) {
    application.setGlobalPrefix(configuration.app.globalPrefix);
  }
  application.useWebSocketAdapter(new WsAdapter(application));
  application.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  const configuredCorsOrigins = configuration.app.corsOrigins;
  application.enableCors({
    credentials: false,
    origin: configuredCorsOrigins.includes('*') ? true : configuredCorsOrigins,
  });
  application.enableShutdownHooks();

  if (configuration.app.openApiEnabled) {
    const swaggerConfiguration = buildOpenApiConfiguration();
    const openApiDocument = completeOpenApiDocument(
      SwaggerModule.createDocument(application, swaggerConfiguration),
    );
    SwaggerModule.setup('docs', application, openApiDocument);
  }

  await application.listen(configuration.app.port);
}
void bootstrap();
