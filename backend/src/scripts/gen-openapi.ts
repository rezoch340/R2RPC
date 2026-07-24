import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { dump } from 'js-yaml';
import { AppModule } from '../app.module';
import { ConfigService } from '../infrastructure/config/config.service';

// 从 @nestjs/swagger 装饰器生成 OpenAPI 3 规范,导出 YAML 到 docs/openapi.yaml。
// preview 模式实例化应用图(不跑生命周期钩子、不连基础设施),纯静态扫描路由元数据。
// 用法: node_modules/.bin/ts-node src/scripts/gen-openapi.ts  (或 pnpm openapi:gen)
async function main() {
  const application = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  // 与 main.ts 一致:若配了全局前缀就套上,保证导出的 path 与运行时相同
  const configuration = new ConfigService();
  if (configuration.app.globalPrefix) {
    application.setGlobalPrefix(configuration.app.globalPrefix);
  }

  // 复用 main.ts 的 DocumentBuilder 配置(标题/版本/Bearer)
  const swaggerConfiguration = new DocumentBuilder()
    .setTitle('RER0RPC API')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const openApiDocument = SwaggerModule.createDocument(
    application,
    swaggerConfiguration,
  );

  const outputPath = join(__dirname, '../../../docs/openapi.yaml');
  writeFileSync(
    outputPath,
    dump(openApiDocument, {
      noRefs: true,
      sortKeys: false,
      lineWidth: -1,
    }),
  );
  console.log(
    `OpenAPI 已写出: ${outputPath}  (paths: ${Object.keys(openApiDocument.paths ?? {}).length})`,
  );

  await application.close();
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
