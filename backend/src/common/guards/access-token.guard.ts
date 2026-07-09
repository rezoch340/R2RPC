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

const POSITIVE_TTL_SEC = 60;
const NEGATIVE_TTL_SEC = 10;

// AccessToken 守卫:校验 Bearer token 有效性(存在/未过期/active)+ 目标 project 作用域。
// redis 仅作缓存,fail-open——任何 redis 异常都当缓存未命中,回落 DB 查询,不阻断鉴权。
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: AccessTokenService,
    private readonly projects: ProjectsService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const h = req.headers.authorization;
    const plain: string | undefined = h?.startsWith('Bearer ')
      ? h.slice(7)
      : undefined;
    if (!plain) throw new UnauthorizedException('缺少 access token');

    // 明文 token 不入 redis key,用 sha256 摘要
    const key = `invoke:token:${createHash('sha256').update(plain).digest('hex')}`;

    let t: CachedToken | null | undefined = await this.readCache(key);
    if (t === undefined) {
      t = await this.tokens.findByToken(plain);
      await this.writeCache(key, t);
    }
    if (!t) throw new UnauthorizedException('无效 token');
    if (t.expiresAt && new Date(t.expiresAt) < new Date()) {
      throw new UnauthorizedException('token 已过期');
    }
    if (t.status !== 'active')
      throw new ForbiddenException('token 已停用/撤销');

    const projectName = req.params.project ?? req.query.project;
    const gid = projectName ? await this.projects.idByName(projectName) : null;
    if (!gid || !t.projectIds.includes(gid))
      throw new ForbiddenException('token 无该 project 权限');

    req.accessToken = { id: t.id, name: t.name, projectIds: t.projectIds };
    return true;
  }

  // 读缓存:命中正缓存返回 token 对象;命中负缓存(notFound)返回 null;
  // 未命中或 redis 异常一律返回 undefined,触发回落 DB(fail-open)
  private async readCache(
    key: string,
  ): Promise<CachedToken | null | undefined> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as {
        notFound?: boolean;
      } & Partial<CachedToken>;
      if (parsed.notFound) return null;
      return parsed as CachedToken;
    } catch {
      return undefined;
    }
  }

  // 写缓存:查无此 token 存短 TTL 负缓存(防伪造 token 打 DB),命中存正常 TTL;
  // redis 异常吞掉,不影响本次鉴权结果
  private async writeCache(key: string, t: CachedToken | null): Promise<void> {
    try {
      if (t === null) {
        await this.redis.client.set(
          key,
          JSON.stringify({ notFound: true }),
          'EX',
          NEGATIVE_TTL_SEC,
        );
      } else {
        await this.redis.client.set(
          key,
          JSON.stringify(t),
          'EX',
          POSITIVE_TTL_SEC,
        );
      }
    } catch {
      // fail-open:缓存写失败不影响鉴权
    }
  }
}
