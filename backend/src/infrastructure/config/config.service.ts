import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { load } from 'js-yaml';
import { AppConfig, configSchema } from './config.schema';

// 集中配置服务:从 CONFIG_FILE(默认 ./config.yaml)读取 YAML,zod 校验,校验失败即抛错终止启动
@Injectable()
export class ConfigService {
  private readonly logger = new Logger('Config');
  readonly all: AppConfig;

  constructor() {
    const configurationFile = process.env.CONFIG_FILE
      ? resolve(process.env.CONFIG_FILE)
      : resolve(process.cwd(), 'config.yaml');
    let configurationSource: unknown;
    try {
      configurationSource = load(readFileSync(configurationFile, 'utf8'));
    } catch (error) {
      throw new Error(
        `读取配置文件失败: ${configurationFile} — ${(error as Error).message}`,
      );
    }
    const validation = configSchema.safeParse(configurationSource);
    if (!validation.success) {
      this.logger.error('配置校验失败,进程终止:');
      this.logger.error(JSON.stringify(validation.error.format(), null, 2));
      throw new Error('配置校验失败,启动终止');
    }
    this.all = Object.freeze(validation.data);
    this.logger.log(`配置已加载: ${configurationFile}`);
  }

  get app() {
    return this.all.app;
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
  get retention() {
    return this.all.retention;
  }
}
