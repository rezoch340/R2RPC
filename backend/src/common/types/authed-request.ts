import type { AuthenticatedUser } from '../../application/rbac/entity/model';

// 经守卫填充的请求上下文——只声明我们读写的字段,避免 getRequest() 返回 any 导致的 unsafe 访问。

// AccessTokenGuard 通过后挂到 req.accessToken 的调用方身份
export interface AccessTokenContext {
  id: number;
  name: string;
  projectIds: number[];
}

export interface AuthedRequest {
  headers: { authorization?: string };
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  user?: AuthenticatedUser; // JwtStrategy.validate 填充
  accessToken?: AccessTokenContext; // AccessTokenGuard 填充
}
