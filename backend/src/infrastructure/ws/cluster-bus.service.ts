import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';

// 跨实例 pub/sub:一条独立 subscriber 连接订阅本实例通道;publish 走主连接。
@Injectable()
export class ClusterBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ClusterBus');
  private sub!: Redis;
  private readonly handlers = new Map<string, (msg: any) => void>();

  constructor(private readonly redis: RedisService) {}

  onModuleInit() {
    // subscriber 连接不能跑普通命令,所以 publish 用主连接 redis.client。duplicate() 复制配置新建连接。
    this.sub = this.redis.client.duplicate();
    this.sub.on('error', (e) => this.logger.warn(`sub: ${e.message}`));
    this.sub.on('message', (channel, payload) => {
      const h = this.handlers.get(channel);
      if (!h) return;
      try {
        h(JSON.parse(payload));
      } catch {
        this.logger.warn(`bad msg on ${channel}`);
      }
    });
  }

  async subscribe(channel: string, handler: (msg: any) => void) {
    this.handlers.set(channel, handler);
    await this.sub.subscribe(channel);
  }

  async publish(channel: string, msg: unknown) {
    await this.redis.client.publish(channel, JSON.stringify(msg));
  }

  onModuleDestroy() {
    this.sub?.disconnect();
  }
}
