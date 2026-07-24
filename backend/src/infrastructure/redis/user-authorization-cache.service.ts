import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ConfigService } from '../config/config.service';
import { userAuthorizationCacheKey } from './cache-keys';
import { RedisCacheAsideService } from './redis-cache-aside.service';

const authorizationSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  isRoot: z.boolean(),
  enabled: z.boolean(),
  permissions: z.array(
    z.object({
      action: z.string(),
      subject: z.string(),
    }),
  ),
});

export type UserAuthorizationSnapshot = z.infer<
  typeof authorizationSnapshotSchema
>;

@Injectable()
export class UserAuthorizationCacheService {
  private readonly ttlSeconds: number;

  constructor(
    configuration: ConfigService,
    private readonly redisCacheAsideService: RedisCacheAsideService,
  ) {
    this.ttlSeconds = configuration.jwt.authorizationCacheTtlSeconds;
  }

  async getOrLoad(
    userId: number,
    loadSnapshot: () => Promise<
      Omit<UserAuthorizationSnapshot, 'schemaVersion'>
    >,
  ): Promise<UserAuthorizationSnapshot> {
    return this.redisCacheAsideService.getOrLoad(
      userAuthorizationCacheKey(userId),
      authorizationSnapshotSchema,
      async () => ({ schemaVersion: 1, ...(await loadSnapshot()) }),
      this.ttlSeconds,
    );
  }

  async writeAndInvalidate<WriteResult>(
    writeOperation: () => Promise<WriteResult>,
    userIds: number[],
  ): Promise<WriteResult> {
    return this.redisCacheAsideService.writeAndInvalidate(
      writeOperation,
      userIds.map((userId) => userAuthorizationCacheKey(userId)),
    );
  }
}
