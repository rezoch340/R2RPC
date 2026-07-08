import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service';

// ioredis 客户端:在线状态镜像、短期调度状态、分布式锁。lazyConnect 避免启动即强连。
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(cfg: ConfigService) {
    this.client = new Redis({
      host: cfg.redis.host,
      port: cfg.redis.port,
      password: cfg.redis.password ?? undefined,
      db: cfg.redis.db,
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
