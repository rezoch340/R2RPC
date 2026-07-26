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
      metadataQueryFields: [],
    });
  });

  it('分页参数不进审计 metadata,翻页不会产生只有页码不同的噪音记录', () => {
    const systemLogRead = inferSystemAuditDefinition(
      createRequest(
        'GET',
        '/system-logs?actorUsername=admin&page=3&pageSize=50',
        {},
        { actorUsername: 'admin', page: '3', pageSize: '50' },
      ),
    );
    const monitorRead = inferSystemAuditDefinition(
      createRequest(
        'GET',
        '/monitor/requests?project=cn-nodes&page=2&pageSize=20',
        {},
        { project: 'cn-nodes', page: '2', pageSize: '20' },
      ),
    );

    // 筛选条件是「谁按什么条件查的」,要留;页码没有取证价值,不留
    expect(systemLogRead?.metadataQueryFields).toEqual(['actorUsername']);
    expect(monitorRead?.metadataQueryFields).toEqual(['project']);
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
