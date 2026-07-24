import type { AuthedRequest } from '../types/authed-request';
import { buildSystemAuditEntry } from './system-audit-entry';

function createRequest(body: Record<string, unknown>): AuthedRequest {
  return {
    body,
    headers: {
      'user-agent': 'audit-test',
      'x-forwarded-for': '192.0.2.10, 10.0.0.1',
    },
    method: 'POST',
    originalUrl: '/users?ignored=true',
    params: {},
    query: {},
    socket: {},
    user: {
      id: 1,
      username: 'admin',
      permissions: [],
      isRoot: true,
    },
  };
}

describe('系统操作审计条目', () => {
  it('生成谁做了什么的人类可读摘要', () => {
    const systemLogEntry = buildSystemAuditEntry({
      definition: {
        name: '创建用户',
        action: 'create',
        subject: 'user',
        targetType: 'user',
        targetNameField: 'username',
        targetResponseField: 'id',
        metadataBodyFields: ['role'],
      },
      request: createRequest({
        username: 'alice',
        password: 'secret-password',
        role: 'operator',
      }),
      responseBody: { id: 20, username: 'alice' },
      status: 'succeeded',
      statusCode: 201,
    });

    expect(systemLogEntry.description).toBe(
      'admin 创建用户 alice (role="operator")',
    );
    expect(systemLogEntry.targetId).toBe('20');
    expect(systemLogEntry.route).toBe('/users');
    expect(systemLogEntry.ipAddress).toBe('192.0.2.10');
  });

  it('只保留装饰器白名单字段且不泄露密码', () => {
    const systemLogEntry = buildSystemAuditEntry({
      definition: {
        name: '修改用户密码',
        action: 'update-password',
        subject: 'user',
        targetType: 'user',
        targetParameter: 'id',
      },
      request: {
        ...createRequest({ password: 'must-not-appear' }),
        method: 'PATCH',
        originalUrl: '/users/20/password',
        params: { id: '20' },
      },
      status: 'succeeded',
      statusCode: 200,
    });

    expect(systemLogEntry.metadata).toEqual({});
    expect(JSON.stringify(systemLogEntry)).not.toContain('must-not-appear');
  });

  it('失败操作保留状态和错误但不改变结构', () => {
    const systemLogEntry = buildSystemAuditEntry({
      definition: {
        name: '删除用户',
        action: 'delete',
        subject: 'user',
        targetType: 'user',
        targetParameter: 'id',
      },
      request: {
        ...createRequest({}),
        method: 'DELETE',
        originalUrl: '/users/999',
        params: { id: '999' },
      },
      status: 'failed',
      statusCode: 404,
      errorMessage: '用户不存在',
    });

    expect(systemLogEntry.status).toBe('failed');
    expect(systemLogEntry.statusCode).toBe(404);
    expect(systemLogEntry.description).toBe('admin 删除用户 999 [失败]');
    expect(systemLogEntry.errorMessage).toBe('用户不存在');
  });
});
