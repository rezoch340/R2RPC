import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from './config.schema';
import { loadApplicationConfiguration } from './config.loader';

// 集中配置服务:从 CONFIG_FILE 或最近的 config.yaml 读取并校验，失败即终止启动。
@Injectable()
export class ConfigService {
  private readonly logger = new Logger('Config');
  readonly all: AppConfig;

  constructor() {
    try {
      const loadedConfiguration = loadApplicationConfiguration();
      this.all = Object.freeze(loadedConfiguration.configuration);
      this.logger.log(`配置已加载: ${loadedConfiguration.configurationFile}`);
    } catch (error) {
      this.logger.error((error as Error).message);
      throw error;
    }
  }

  get app() {
    return this.all.app;
  }
  get frontend() {
    return this.all.frontend;
  }
  get db() {
    return this.all.db;
  }
  get redis() {
    return this.all.redis;
  }
  get jwt() {
    return this.all.jwt;
  }
  get manticore() {
    return this.all.manticore;
  }
  get bootstrap() {
    return this.all.bootstrap;
  }
  get retention() {
    return this.all.retention;
  }
}
