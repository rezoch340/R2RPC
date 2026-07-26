import type { AuthedRequest } from '../types/authed-request';
import { inferSystemAuditDefinition } from './system-audit-definition';

function createRequest(
  method: string,
  originalUrl: string,
  parameters: Record<string, string | undefined> = {},
  query: Record<string, string | undefined> = {},
): AuthedRequest {
  return {
    body: undefined,
    headers: {},
    method,
    originalUrl,
    params: parameters,
    query,
    socket: {},
  };
}

describe('系统访问审计定义推导', () => {
  it('读取控制面接口时记录资源和查询条件', () => {
    const definition = inferSystemAuditDefinition(
      createRequest(
        'GET',
        '/system-logs?page=2&token=must-not-appear',
        {},
        { page: '2', token: 'must-not-appear' },
      ),
    );

    expect(definition).toEqual({
      name: '读取系统日志',
      action: 'read',
      subject: 'system-log',
      targetType: 'system-log',
      targetParameter: undefined,
      skipSuccessfulRead: true,
      metadataQueryFields: ['page'],
    });
  });

  it('只有系统日志自身跳过成功读取,其余控制面读取照常记录', () => {
    const systemLogRead = inferSystemAuditDefinition(
      createRequest('GET', '/system-logs'),
    );
    const userRead = inferSystemAuditDefinition(createRequest('GET', '/users'));
    const monitorRead = inferSystemAuditDefinition(
      createRequest('GET', '/monitor/requests'),
    );

    expect(systemLogRead?.skipSuccessfulRead).toBe(true);
    expect(userRead?.skipSuccessfulRead).toBeUndefined();
    expect(monitorRead?.skipSuccessfulRead).toBeUndefined();
  });

  it('系统日志的写入型操作不跳过审计', () => {
    const systemLogDelete = inferSystemAuditDefinition(
      createRequest('DELETE', '/system-logs/9', { id: '9' }),
    );

    // 标志仍在定义上,但拦截器只在 action==='read' 时跳过,写操作照常留痕
    expect(systemLogDelete?.action).toBe('delete');
  });

  it('拒绝在系统日志中重复记录 RPC 数据面', () => {
    const definition = inferSystemAuditDefinition(
      createRequest('POST', '/rpc/invoke/example/echo'),
    );

    expect(definition).toBeNull();
  });

  it('Guard 拒绝前仍可根据方法和参数生成通用操作定义', () => {
    const definition = inferSystemAuditDefinition(
      createRequest('DELETE', '/users/19', { id: '19' }),
    );

    expect(definition).toMatchObject({
      name: '删除后台账号',
      action: 'delete',
      subject: 'user',
      targetType: 'user',
      targetParameter: 'id',
    });
  });
});
