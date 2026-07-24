import { z } from 'zod';
import { RedisCacheAsideService } from './redis-cache-aside.service';
import { RedisService } from './redis.service';

describe('Redis 公共 cache-aside 组件', () => {
  const redisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const redisCacheAsideService = new RedisCacheAsideService({
    client: redisClient,
  } as unknown as RedisService);
  const cachedValueSchema = z.object({ name: z.string() });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Redis 命中时直接返回且不查询持久层', async () => {
    redisClient.get.mockResolvedValue(JSON.stringify({ name: 'cached' }));
    const loadValue = jest.fn();

    const result = await redisCacheAsideService.getOrLoad(
      'test:key',
      cachedValueSchema,
      loadValue,
      15,
    );

    expect(result).toEqual({ name: 'cached' });
    expect(loadValue).not.toHaveBeenCalled();
    expect(redisClient.set).not.toHaveBeenCalled();
  });

  it('Redis 未命中时查询持久层并回写 Redis', async () => {
    redisClient.get.mockResolvedValue(null);
    redisClient.set.mockResolvedValue('OK');
    const loadValue = jest.fn().mockResolvedValue({ name: 'database' });

    const result = await redisCacheAsideService.getOrLoad(
      'test:key',
      cachedValueSchema,
      loadValue,
      15,
    );

    expect(result).toEqual({ name: 'database' });
    expect(loadValue).toHaveBeenCalledTimes(1);
    expect(redisClient.set).toHaveBeenCalledWith(
      'test:key',
      JSON.stringify({ name: 'database' }),
      'EX',
      15,
    );
  });

  it('支持负缓存命中并按加载结果选择 TTL', async () => {
    redisClient.get.mockResolvedValueOnce('null').mockResolvedValueOnce(null);
    redisClient.set.mockResolvedValue('OK');
    const loadValue = jest.fn().mockResolvedValue(null);
    const nullableSchema = cachedValueSchema.nullable();

    const cachedResult = await redisCacheAsideService.getOrLoad(
      'test:negative',
      nullableSchema,
      loadValue,
      (value) => (value === null ? 10 : 60),
    );
    const loadedResult = await redisCacheAsideService.getOrLoad(
      'test:missing',
      nullableSchema,
      loadValue,
      (value) => (value === null ? 10 : 60),
    );

    expect(cachedResult).toBeNull();
    expect(loadedResult).toBeNull();
    expect(loadValue).toHaveBeenCalledTimes(1);
    expect(redisClient.set).toHaveBeenCalledWith(
      'test:missing',
      'null',
      'EX',
      10,
    );
  });

  it('缓存数据不符合契约时删除脏缓存并回源', async () => {
    redisClient.get.mockResolvedValue(JSON.stringify({ unexpected: true }));
    redisClient.del.mockResolvedValue(1);
    redisClient.set.mockResolvedValue('OK');
    const loadValue = jest.fn().mockResolvedValue({ name: 'database' });

    const result = await redisCacheAsideService.getOrLoad(
      'test:invalid',
      cachedValueSchema,
      loadValue,
      15,
    );

    expect(result).toEqual({ name: 'database' });
    expect(redisClient.del).toHaveBeenCalledWith('test:invalid');
    expect(loadValue).toHaveBeenCalledTimes(1);
  });

  it('Redis 读取失败时回源且不阻断回写尝试', async () => {
    redisClient.get.mockRejectedValue(new Error('redis unavailable'));
    redisClient.set.mockResolvedValue('OK');
    const loadValue = jest.fn().mockResolvedValue({ name: 'database' });

    const result = await redisCacheAsideService.getOrLoad(
      'test:unavailable',
      cachedValueSchema,
      loadValue,
      60,
    );

    expect(result).toEqual({ name: 'database' });
    expect(loadValue).toHaveBeenCalledTimes(1);
    expect(redisClient.set).toHaveBeenCalledWith(
      'test:unavailable',
      JSON.stringify({ name: 'database' }),
      'EX',
      60,
    );
  });

  it('持久层写入成功后删除去重后的缓存键', async () => {
    redisClient.del.mockResolvedValue(2);
    const writeOperation = jest.fn().mockResolvedValue({ updated: true });

    const result = await redisCacheAsideService.writeAndInvalidate(
      writeOperation,
      ['test:first', 'test:first', 'test:second'],
    );

    expect(result).toEqual({ updated: true });
    expect(redisClient.del).toHaveBeenCalledWith('test:first', 'test:second');
  });

  it('持久层写入失败时不删除缓存', async () => {
    const writeFailure = new Error('write failed');
    const writeOperation = jest.fn().mockRejectedValue(writeFailure);

    await expect(
      redisCacheAsideService.writeAndInvalidate(writeOperation, 'test:key'),
    ).rejects.toBe(writeFailure);
    expect(redisClient.del).not.toHaveBeenCalled();
  });
});
