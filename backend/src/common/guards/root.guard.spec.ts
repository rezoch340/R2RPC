import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RootGuard } from './root.guard';

function createExecutionContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('种子管理员身份闸', () => {
  const rootGuard = new RootGuard();

  it('放行种子管理员', () => {
    expect(
      rootGuard.canActivate(
        createExecutionContext({ id: 1, isRoot: true, permissions: [] }),
      ),
    ).toBe(true);
  });

  it('拒绝具有 manage/rbac 的非 root 用户', () => {
    const user = {
      id: 2,
      isRoot: false,
      permissions: [{ action: 'manage', subject: 'rbac' }],
    };
    expect(() => rootGuard.canActivate(createExecutionContext(user))).toThrow(
      ForbiddenException,
    );
  });

  it('拒绝缺失鉴权身份的请求', () => {
    expect(() =>
      rootGuard.canActivate(createExecutionContext(undefined)),
    ).toThrow(ForbiddenException);
  });
});
