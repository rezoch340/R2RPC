import { Global, Module } from '@nestjs/common';
import { RedisCacheAsideService } from './redis-cache-aside.service';
import { RedisService } from './redis.service';
import { UserAuthorizationCacheService } from './user-authorization-cache.service';

@Global()
@Module({
  providers: [
    RedisService,
    RedisCacheAsideService,
    UserAuthorizationCacheService,
  ],
  exports: [
    RedisService,
    RedisCacheAsideService,
    UserAuthorizationCacheService,
  ],
})
export class RedisModule {}
