import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { RedisService } from './redis.service';

type CacheKeySelection<WriteResult> =
  string | string[] | ((writeResult: WriteResult) => string | string[]);
type TimeToLiveSelection<Value> = number | ((loadedValue: Value) => number);

@Injectable()
export class RedisCacheAsideService {
  private readonly logger = new Logger(RedisCacheAsideService.name);

  constructor(private readonly redisService: RedisService) {}

  async get<Value>(
    cacheKey: string,
    valueSchema: z.ZodType<Value>,
  ): Promise<Value | undefined> {
    try {
      const serializedValue = await this.redisService.client.get(cacheKey);
      if (!serializedValue) {
        return undefined;
      }
      const validation = valueSchema.safeParse(JSON.parse(serializedValue));
      if (validation.success) {
        return validation.data;
      }
      await this.invalidate(cacheKey);
      return undefined;
    } catch (cacheReadError) {
      this.logger.warn(
        `读取 Redis 缓存失败: ${this.errorMessage(cacheReadError)}`,
      );
      return undefined;
    }
  }

  async set(
    cacheKey: string,
    value: unknown,
    timeToLiveSeconds: number,
  ): Promise<void> {
    try {
      await this.redisService.client.set(
        cacheKey,
        JSON.stringify(value),
        'EX',
        timeToLiveSeconds,
      );
    } catch (cacheWriteError) {
      this.logger.warn(
        `写入 Redis 缓存失败: ${this.errorMessage(cacheWriteError)}`,
      );
    }
  }

  async getOrLoad<Value>(
    cacheKey: string,
    valueSchema: z.ZodType<Value>,
    loadValue: () => Promise<Value>,
    timeToLiveSelection: TimeToLiveSelection<Value>,
  ): Promise<Value> {
    const cachedValue = await this.get(cacheKey, valueSchema);
    if (cachedValue !== undefined) {
      return cachedValue;
    }
    const loadedValue = await loadValue();
    const timeToLiveSeconds =
      typeof timeToLiveSelection === 'function'
        ? timeToLiveSelection(loadedValue)
        : timeToLiveSelection;
    await this.set(cacheKey, loadedValue, timeToLiveSeconds);
    return loadedValue;
  }

  async invalidate(cacheKeys: string | string[]): Promise<void> {
    const uniqueCacheKeys = [
      ...new Set(Array.isArray(cacheKeys) ? cacheKeys : [cacheKeys]),
    ];
    if (uniqueCacheKeys.length === 0) {
      return;
    }
    try {
      await this.redisService.client.del(...uniqueCacheKeys);
    } catch (cacheDeleteError) {
      this.logger.warn(
        `删除 Redis 缓存失败: ${this.errorMessage(cacheDeleteError)}`,
      );
    }
  }

  async writeAndInvalidate<WriteResult>(
    writeOperation: () => Promise<WriteResult>,
    cacheKeySelection: CacheKeySelection<WriteResult>,
  ): Promise<WriteResult> {
    const writeResult = await writeOperation();
    const cacheKeys =
      typeof cacheKeySelection === 'function'
        ? cacheKeySelection(writeResult)
        : cacheKeySelection;
    await this.invalidate(cacheKeys);
    return writeResult;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
