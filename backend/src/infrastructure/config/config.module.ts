import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';

// 全局配置模块,任何模块都能注入 ConfigService,无需重复 import
@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
