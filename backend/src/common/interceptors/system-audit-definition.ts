import type { SystemAuditDefinition } from '../decorators/system-audit.decorator';
import type { AuthedRequest } from '../types/authed-request';

interface AuditedResource {
  label: string;
  subject: string;
  targetType: string;
  safeQueryFields?: string[];
}

const AUDITED_RESOURCES: Record<string, AuditedResource> = {
  auth: {
    label: '认证信息',
    subject: 'auth',
    targetType: 'authentication',
  },
  users: {
    label: '后台账号',
    subject: 'user',
    targetType: 'user',
  },
  projects: {
    label: '功能组',
    subject: 'project',
    targetType: 'project',
  },
  devices: {
    label: '设备',
    subject: 'device',
    targetType: 'device',
  },
  'access-tokens': {
    label: 'Access Token',
    subject: 'access-token',
    targetType: 'access-token',
  },
  'device-tokens': {
    label: 'Device Token',
    subject: 'device-token',
    targetType: 'device-token',
  },
  rbac: {
    label: '权限配置',
    subject: 'rbac',
    targetType: 'rbac',
  },
  monitor: {
    label: '请求日志',
    subject: 'monitor',
    targetType: 'request-log',
    safeQueryFields: [
      'project',
      'action',
      'clientId',
      'status',
      'from',
      'to',
      'page',
      'pageSize',
    ],
  },
  metrics: {
    label: '指标',
    subject: 'metrics',
    targetType: 'metrics',
    safeQueryFields: ['project', 'days'],
  },
  'system-logs': {
    label: '系统日志',
    subject: 'system-log',
    targetType: 'system-log',
    safeQueryFields: [
      'actorUsername',
      'action',
      'subject',
      'status',
      'from',
      'to',
      'page',
      'pageSize',
    ],
  },
};

const ACTION_BY_METHOD: Record<string, { action: string; namePrefix: string }> =
  {
    GET: { action: 'read', namePrefix: '读取' },
    POST: { action: 'execute', namePrefix: '执行' },
    PATCH: { action: 'update', namePrefix: '修改' },
    PUT: { action: 'update', namePrefix: '修改' },
    DELETE: { action: 'delete', namePrefix: '删除' },
  };

function routeSegments(request: AuthedRequest): string[] {
  return request.originalUrl
    .split('?')[0]
    .split('/')
    .filter((routeSegment) => routeSegment.length > 0);
}

function auditedResourceOf(request: AuthedRequest): AuditedResource | null {
  for (const routeSegment of routeSegments(request)) {
    const auditedResource = AUDITED_RESOURCES[routeSegment];
    if (auditedResource) {
      return auditedResource;
    }
  }
  return null;
}

function targetParameterOf(request: AuthedRequest): string | undefined {
  return Object.keys(request.params).find(
    (parameterName) => request.params[parameterName] !== undefined,
  );
}

export function inferSystemAuditDefinition(
  request: AuthedRequest,
): SystemAuditDefinition | null {
  const auditedResource = auditedResourceOf(request);
  const operation = ACTION_BY_METHOD[request.method.toUpperCase()];
  if (!auditedResource || !operation) {
    return null;
  }

  return {
    name: `${operation.namePrefix}${auditedResource.label}`,
    action: operation.action,
    subject: auditedResource.subject,
    targetType: auditedResource.targetType,
    targetParameter: targetParameterOf(request),
    metadataQueryFields: auditedResource.safeQueryFields?.filter(
      (fieldName) => request.query[fieldName] !== undefined,
    ),
  };
}
