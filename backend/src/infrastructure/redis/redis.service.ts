import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service';

// ioredis 客户端:在线状态镜像、短期调度状态、分布式锁。
// 断连时命令快速失败(而非无限等待),让 invoke 能走降级同步写 PG 脊柱。
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');
  readonly client: Redis;

  constructor(cfg: ConfigService) {
    this.client = new Redis({
      host: cfg.redis.host,
      port: cfg.redis.port,
      password: cfg.redis.password ?? undefined,
      db: cfg.redis.db,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      commandTimeout: 5000,
    });
    // 监听 error,避免未处理的 error 事件;断连本身不致命
    this.client.on('error', (e) => this.logger.warn(`redis: ${e.message}`));
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
