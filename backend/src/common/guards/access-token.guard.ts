import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AccessTokenService } from '../../application/access-token/access-token.service';
import { ProjectsService } from '../../application/projects/projects.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
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

// AccessToken 守卫:校验 Bearer token 有效性(存在/未过期/active)+ 目标 project 作用域。
// redis 仅作缓存,fail-open——任何 redis 异常都当缓存未命中,回落 DB 查询,不阻断鉴权。
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly projectsService: ProjectsService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const request = executionContext.switchToHttp().getRequest<AuthedRequest>();
    const plaintextToken = this.bearerToken(request.headers.authorization);
    if (!plaintextToken) {
      throw new UnauthorizedException('缺少 access token');
    }

    // 明文 token 不入 redis key,用 sha256 摘要
    const cacheKey = `invoke:token:${createHash('sha256')
      .update(plaintextToken)
      .digest('hex')}`;

    let cachedToken = await this.readCache(cacheKey);
    if (cachedToken === undefined) {
      cachedToken = await this.accessTokenService.findByToken(plaintextToken);
      await this.writeCache(cacheKey, cachedToken);
    }
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

  // 读缓存:命中正缓存返回 token 对象;命中负缓存(notFound)返回 null;
  // 未命中或 redis 异常一律返回 undefined,触发回落 DB(fail-open)
  private async readCache(
    cacheKey: string,
  ): Promise<CachedToken | null | undefined> {
    try {
      const serializedToken = await this.redisService.client.get(cacheKey);
      if (!serializedToken) {
        return undefined;
      }
      const cachedToken = JSON.parse(serializedToken) as {
        notFound?: boolean;
      } & Partial<CachedToken>;
      if (cachedToken.notFound) {
        return null;
      }
      return cachedToken as CachedToken;
    } catch {
      return undefined;
    }
  }

  // 写缓存:查无此 token 存短 TTL 负缓存(防伪造 token 打 DB),命中存正常 TTL;
  // redis 异常吞掉,不影响本次鉴权结果
  private async writeCache(
    cacheKey: string,
    cachedToken: CachedToken | null,
  ): Promise<void> {
    try {
      if (cachedToken === null) {
        await this.redisService.client.set(
          cacheKey,
          JSON.stringify({ notFound: true }),
          'EX',
          NEGATIVE_CACHE_TIME_TO_LIVE_SECONDS,
        );
        return;
      }
      await this.redisService.client.set(
        cacheKey,
        JSON.stringify(cachedToken),
        'EX',
        POSITIVE_CACHE_TIME_TO_LIVE_SECONDS,
      );
    } catch {
      // fail-open:缓存写失败不影响鉴权
    }
  }
}
