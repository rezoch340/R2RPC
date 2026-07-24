import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';

// 跨实例 pub/sub:一条独立 subscriber 连接订阅本实例通道;publish 走主连接。
@Injectable()
export class ClusterBus implements OnModuleDestroy {
  private readonly logger = new Logger('ClusterBus');
  private readonly subscriber: Redis;
  private readonly handlers = new Map<
    string,
    (message: any) => void | Promise<void>
  >();

  constructor(private readonly redisService: RedisService) {
    // 在构造函数里建(而非 onModuleInit):Nest 的 onModuleInit 按 providers 数组声明顺序调用,
    // 不保证依赖方(ConnectionRegistry)晚于本类初始化——ConnectionRegistry.onModuleInit 里同步调了
    // subscribe(),若 this.subscriber 还没建好就会炸。redis.client 在 RedisService 构造函数里已同步就绪,
    // 这里直接用,不用等 onModuleInit,从根上去掉这个初始化顺序依赖。
    // subscriber 连接不能跑普通命令,所以 publish 用主连接 redis.client。duplicate() 复制配置新建连接。
    this.subscriber = this.redisService.client.duplicate();
    this.subscriber.on('error', (error) =>
      this.logger.warn(`subscriber: ${error.message}`),
    );
    this.subscriber.on('message', (channel, payload) => {
      const handler = this.handlers.get(channel);
      if (!handler) {
        return;
      }
      try {
        void Promise.resolve(handler(JSON.parse(payload))).catch(
          (handlerError) =>
            this.logger.warn(
              `handler error on ${channel}: ${(handlerError as Error).message}`,
            ),
        );
      } catch {
        this.logger.warn(`bad msg on ${channel}`);
      }
    });
  }

  async subscribe(
    channel: string,
    handler: (message: any) => void | Promise<void>,
  ) {
    this.handlers.set(channel, handler);
    await this.subscriber.subscribe(channel);
  }

  async publish(channel: string, message: unknown) {
    await this.redisService.client.publish(channel, JSON.stringify(message));
  }

  onModuleDestroy() {
    this.subscriber?.disconnect();
  }
}
