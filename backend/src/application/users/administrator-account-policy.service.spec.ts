import { ForbiddenException } from '@nestjs/common';
import { assertAdministratorMutationAllowed } from './administrator-account-policy.service';

describe('管理员账号修改策略', () => {
  it('拒绝其他账号修改受保护管理员', () => {
    expect(() =>
      assertAdministratorMutationAllowed(20, { id: 10, isRoot: true }),
    ).toThrow(ForbiddenException);
  });

  it('允许受保护管理员修改自己', () => {
    expect(() =>
      assertAdministratorMutationAllowed(10, { id: 10, isRoot: true }),
    ).not.toThrow();
  });

  it('允许具有接口权限的调用方修改普通账号', () => {
    expect(() =>
      assertAdministratorMutationAllowed(10, { id: 20, isRoot: false }),
    ).not.toThrow();
  });
});
