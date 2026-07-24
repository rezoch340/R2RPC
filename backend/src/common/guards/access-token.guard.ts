import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { AccessTokenService } from '../../application/access-token/access-token.service';
import { ProjectsService } from '../../application/projects/projects.service';
import { accessTokenCacheKey } from '../../infrastructure/redis/cache-keys';
import { RedisCacheAsideService } from '../../infrastructure/redis/redis-cache-aside.service';
import type { AuthedRequest } from '../types/authed-request';

type CachedToken = {
  id: number;
  name: string;
  status: string;
  expiresAt: Date | string | null;
  projectIds: number[];
};

const POSITIVE_CACHE_TIME_TO_LIVE_SECONDS = 60;
const NEGATIVE_CACHE_TIME_TO_LIVE_SECONDS = 10;
const cachedAccessTokenSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    status: z.string(),
    expiresAt: z.union([z.date(), z.string()]).nullable(),
    projectIds: z.array(z.number().int()),
  })
  .nullable();

// AccessToken 守卫:校验 Bearer token 有效性(存在/未过期/active)+ 目标 project 作用域。
// redis 仅作缓存,fail-open——任何 redis 异常都当缓存未命中,回落 DB 查询,不阻断鉴权。
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly projectsService: ProjectsService,
    private readonly redisCacheAsideService: RedisCacheAsideService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<AuthedRequest>();
    const plaintextToken = this.bearerToken(request.headers.authorization);
    if (!plaintextToken) {
      throw new UnauthorizedException('缺少 access token');
    }

    // 明文 token 不入 redis key,用 sha256 摘要
    const cacheKey = accessTokenCacheKey(plaintextToken);
    const cachedToken = await this.redisCacheAsideService.getOrLoad(
      cacheKey,
      cachedAccessTokenSchema,
      () => this.accessTokenService.findByToken(plaintextToken),
      (loadedToken) =>
        loadedToken
          ? POSITIVE_CACHE_TIME_TO_LIVE_SECONDS
          : NEGATIVE_CACHE_TIME_TO_LIVE_SECONDS,
    );
    this.assertTokenIsUsable(cachedToken);

    const projectName = request.params.project ?? request.query.project;
    const projectId = projectName
      ? await this.projectsService.idByName(projectName)
      : null;
    if (!projectId || !cachedToken.projectIds.includes(projectId)) {
      throw new ForbiddenException('token 无该 project 权限');
    }

    request.accessToken = {
      id: cachedToken.id,
      name: cachedToken.name,
      projectIds: cachedToken.projectIds,
    };
    return true;
  }

  private bearerToken(authorizationHeader: string | undefined) {
    if (!authorizationHeader?.startsWith('Bearer ')) {
      return undefined;
    }
    return authorizationHeader.slice(7);
  }

  private assertTokenIsUsable(
    cachedToken: CachedToken | null,
  ): asserts cachedToken is CachedToken {
    if (!cachedToken) {
      throw new UnauthorizedException('无效 token');
    }
    if (cachedToken.expiresAt && new Date(cachedToken.expiresAt) < new Date()) {
      throw new UnauthorizedException('token 已过期');
    }
    if (cachedToken.status !== 'active') {
      throw new ForbiddenException('token 已停用/撤销');
    }
  }
}
