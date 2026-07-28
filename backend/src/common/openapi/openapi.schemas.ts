import type { OpenAPIObject } from '@nestjs/swagger';

type SchemaDefinition = NonNullable<
  NonNullable<OpenAPIObject['components']>['schemas']
>[string];

// 分页信封:结构固定,只有 rows 的元素类型不同
function pageSchema(itemSchemaName: string): SchemaDefinition {
  return {
    type: 'object',
    required: ['rows', 'page', 'pageSize', 'total'],
    properties: {
      rows: {
        type: 'array',
        items: { $ref: `#/components/schemas/${itemSchemaName}` },
      },
      page: { type: 'integer', minimum: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 },
      total: { type: 'integer', minimum: 0 },
    },
  };
}

const dateTimeSchema = {
  type: 'string',
  format: 'date-time',
} satisfies SchemaDefinition;

const nullableDateTimeSchema = {
  ...dateTimeSchema,
  nullable: true,
} satisfies SchemaDefinition;

const nullableStringSchema = {
  type: 'string',
  nullable: true,
} satisfies SchemaDefinition;

const jsonValueSchema = {
  description: '任意可 JSON 序列化的值',
  nullable: true,
} satisfies SchemaDefinition;

const clientOnlineStatusSchema: SchemaDefinition = {
  type: 'object',
  required: ['clientId', 'online'],
  properties: {
    clientId: { type: 'string' },
    online: { type: 'boolean' },
  },
};

const projectOnlineDevicesSchema: SchemaDefinition = {
  type: 'object',
  required: ['project', 'online'],
  properties: {
    project: { type: 'string' },
    online: { type: 'array', items: { type: 'string' } },
  },
};

const permissionProperties = {
  id: { type: 'integer', example: 1 },
  action: { type: 'string', example: 'read' },
  subject: { type: 'string', example: 'monitor' },
  description: nullableStringSchema,
} satisfies Record<string, SchemaDefinition>;

const requestLogProperties = {
  id: { type: 'integer', example: 1 },
  requestId: { type: 'string', format: 'uuid' },
  projectName: { type: 'string', example: 'cn-nodes' },
  actionName: { type: 'string', example: 'ping' },
  clientId: nullableStringSchema,
  requesterUserId: { type: 'integer', nullable: true },
  accessTokenId: { type: 'integer', nullable: true },
  status: {
    type: 'string',
    example: 'ok',
    description:
      '业务状态，例如 ok、timeout、error、no_project、no_device、offline、disabled、rejected',
  },
  httpCode: { type: 'integer', nullable: true, example: 200 },
  latencyMs: { type: 'integer', nullable: true, minimum: 0 },
  errorMessage: nullableStringSchema,
  payloadState: {
    type: 'string',
    enum: ['pending', 'indexed', 'failed', 'unavailable'],
  },
  createdAt: dateTimeSchema,
  finishedAt: nullableDateTimeSchema,
} satisfies Record<string, SchemaDefinition>;

const tokenProperties = {
  id: { type: 'integer', example: 1 },
  name: { type: 'string', example: 'production-caller' },
  token: {
    type: 'string',
    description: '明文令牌；Access Token 使用 rk_，Device Token 使用 dk_。',
  },
  status: { type: 'string', enum: ['active', 'revoked'] },
  description: nullableStringSchema,
  createdBy: { type: 'integer', nullable: true },
  createdAt: dateTimeSchema,
  deletedAt: nullableDateTimeSchema,
  projects: {
    type: 'array',
    items: { type: 'string' },
  },
} satisfies Record<string, SchemaDefinition>;

export const OPEN_API_RESPONSE_SCHEMAS = {
  ErrorResponse: {
    type: 'object',
    required: ['statusCode', 'message', 'timestamp'],
    properties: {
      statusCode: { type: 'integer', example: 400 },
      message: {
        oneOf: [
          { type: 'string', example: '请求参数非法' },
          {
            type: 'array',
            items: { type: 'string' },
            example: ['name must be a string'],
          },
          {
            type: 'object',
            additionalProperties: true,
            description:
              'Nest HttpException 的结构化响应，例如 statusCode/message/error。',
          },
        ],
      },
      timestamp: dateTimeSchema,
    },
  },
  DeletedResult: {
    type: 'object',
    required: ['deleted'],
    properties: { deleted: { type: 'boolean', enum: [true] } },
  },
  AttachedResult: {
    type: 'object',
    required: ['attached'],
    properties: { attached: { type: 'boolean', enum: [true] } },
  },
  DetachedResult: {
    type: 'object',
    required: ['detached'],
    properties: { detached: { type: 'boolean', enum: [true] } },
  },
  AssignedResult: {
    type: 'object',
    required: ['assigned'],
    properties: { assigned: { type: 'boolean', enum: [true] } },
  },
  UnassignedResult: {
    type: 'object',
    required: ['unassigned'],
    properties: { unassigned: { type: 'boolean', enum: [true] } },
  },
  Permission: {
    type: 'object',
    required: ['id', 'action', 'subject'],
    properties: {
      ...permissionProperties,
      deletedAt: nullableDateTimeSchema,
    },
  },
  PermissionTuple: {
    type: 'object',
    required: ['action', 'subject'],
    properties: {
      action: permissionProperties.action,
      subject: permissionProperties.subject,
    },
  },
  PermissionGroup: {
    type: 'object',
    required: ['id', 'name', 'createdAt', 'permissions'],
    properties: {
      id: { type: 'integer', example: 1 },
      name: { type: 'string', example: 'operator' },
      description: nullableStringSchema,
      createdAt: dateTimeSchema,
      permissions: {
        type: 'array',
        items: { $ref: '#/components/schemas/Permission' },
      },
    },
  },
  User: {
    type: 'object',
    required: ['id', 'username', 'role', 'isRoot', 'enabled', 'createdAt'],
    properties: {
      id: { type: 'integer', example: 1 },
      username: { type: 'string', example: 'admin' },
      role: { type: 'string', enum: ['admin', 'operator'] },
      isRoot: { type: 'boolean' },
      enabled: { type: 'boolean' },
      description: nullableStringSchema,
      lastLoginAt: nullableDateTimeSchema,
      createdAt: dateTimeSchema,
    },
  },
  UserEnabledResult: {
    type: 'object',
    required: ['id', 'username', 'enabled'],
    properties: {
      id: { type: 'integer' },
      username: { type: 'string' },
      enabled: { type: 'boolean' },
    },
  },
  AuthenticatedUser: {
    type: 'object',
    required: ['id', 'sub', 'username', 'permissions', 'isRoot'],
    properties: {
      id: { type: 'integer', example: 1 },
      sub: {
        oneOf: [{ type: 'integer' }, { type: 'string' }],
        description: 'JWT subject',
      },
      username: { type: 'string', example: 'admin' },
      permissions: {
        type: 'array',
        items: { $ref: '#/components/schemas/PermissionTuple' },
      },
      isRoot: { type: 'boolean' },
    },
  },
  LoginResponse: {
    type: 'object',
    required: ['token', 'user'],
    properties: {
      token: { type: 'string', description: '后台管理员 JWT' },
      user: {
        type: 'object',
        required: ['id', 'username', 'role'],
        properties: {
          id: { type: 'integer' },
          username: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'operator'] },
        },
      },
    },
  },
  AccessTokenRecord: {
    type: 'object',
    required: [
      'id',
      'name',
      'token',
      'status',
      'expiresAt',
      'maximumUsageCount',
      'usageCount',
      'createdAt',
      'projects',
    ],
    properties: {
      ...tokenProperties,
      expiresAt: nullableDateTimeSchema,
      maximumUsageCount: {
        type: 'integer',
        nullable: true,
        minimum: 1,
        description: '最大 RPC 调用次数；null 表示不限制。',
      },
      usageCount: {
        type: 'integer',
        minimum: 0,
        description: '已消耗的 RPC 调用次数。',
      },
    },
  },
  DeviceTokenRecord: {
    type: 'object',
    required: ['id', 'name', 'token', 'status', 'createdAt', 'projects'],
    properties: {
      ...tokenProperties,
      onlineDeviceCount: {
        type: 'integer',
        minimum: 0,
        description: '列表接口返回的当前在线设备数',
      },
    },
  },
  Project: {
    type: 'object',
    required: ['id', 'name', 'enabled', 'createdAt'],
    properties: {
      id: { type: 'integer', example: 1 },
      name: { type: 'string', example: 'cn-nodes' },
      description: nullableStringSchema,
      enabled: { type: 'boolean' },
      createdAt: dateTimeSchema,
      deletedAt: nullableDateTimeSchema,
    },
  },
  ProjectEnabledResult: {
    type: 'object',
    required: ['id', 'name', 'enabled'],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      enabled: { type: 'boolean' },
    },
  },
  ProjectInfo: {
    type: 'object',
    required: [
      'id',
      'name',
      'enabled',
      'totalDevices',
      'onlineDevices',
      'requests7d',
      'success7d',
      'successRate',
      'status',
    ],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      description: nullableStringSchema,
      enabled: { type: 'boolean' },
      totalDevices: { type: 'integer', minimum: 0 },
      onlineDevices: { type: 'integer', minimum: 0 },
      lastSeenAt: nullableDateTimeSchema,
      requests7d: { type: 'integer', minimum: 0 },
      success7d: { type: 'integer', minimum: 0 },
      successRate: { type: 'number', minimum: 0, maximum: 100 },
      status: {
        type: 'string',
        enum: ['online', 'offline', 'stale', 'disabled', 'no_device'],
      },
    },
  },
  Device: {
    type: 'object',
    required: ['id', 'clientId', 'online', 'status'],
    properties: {
      id: { type: 'integer' },
      clientId: { type: 'string' },
      deviceTokenId: { type: 'integer', nullable: true },
      online: { type: 'boolean' },
      status: { type: 'string', enum: ['online', 'offline', 'stale'] },
      platform: nullableStringSchema,
      lastIp: nullableStringSchema,
      extra: nullableStringSchema,
      maxInFlight: {
        type: 'integer',
        nullable: true,
        minimum: 1,
        maximum: 1024,
        description:
          '设备上报并由服务端执行的在途 RPC 上限；未上报或非法时默认 16，超过 1024 时限制为 1024。',
      },
      description: nullableStringSchema,
      lastSeenAt: nullableDateTimeSchema,
      deletedAt: nullableDateTimeSchema,
    },
  },
  MetricsOverview: {
    type: 'object',
    required: ['totals', 'byStatus', 'byProject'],
    properties: {
      totals: {
        type: 'object',
        required: ['total', 'ok', 'failed', 'avgLatencyMs'],
        properties: {
          total: { type: 'integer', minimum: 0 },
          ok: { type: 'integer', minimum: 0 },
          failed: { type: 'integer', minimum: 0 },
          avgLatencyMs: { type: 'integer', minimum: 0 },
        },
      },
      byStatus: {
        type: 'array',
        items: {
          type: 'object',
          required: ['status', 'count'],
          properties: {
            status: { type: 'string' },
            count: { type: 'integer', minimum: 0 },
          },
        },
      },
      byProject: {
        type: 'array',
        items: {
          type: 'object',
          required: ['project', 'count'],
          properties: {
            project: { type: 'string' },
            count: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
  },
  WeeklyDeviceMetrics: {
    type: 'object',
    required: [
      'clientId',
      'project',
      'totalRequests',
      'successRequests',
      'failedRequests',
      'timeoutRequests',
      'avgLatencyMs',
      'maxLatencyMs',
    ],
    properties: {
      clientId: { type: 'string' },
      project: { type: 'string' },
      totalRequests: { type: 'integer', minimum: 0 },
      successRequests: { type: 'integer', minimum: 0 },
      failedRequests: { type: 'integer', minimum: 0 },
      timeoutRequests: { type: 'integer', minimum: 0 },
      avgLatencyMs: { type: 'integer', minimum: 0 },
      maxLatencyMs: { type: 'integer', minimum: 0 },
    },
  },
  DailyTrendPoint: {
    type: 'object',
    required: [
      'statDate',
      'totalRequests',
      'successRequests',
      'failedRequests',
      'timeoutRequests',
      'avgLatencyMs',
      'maxLatencyMs',
      'successRate',
    ],
    properties: {
      statDate: { type: 'string', format: 'date' },
      totalRequests: { type: 'integer', minimum: 0 },
      successRequests: { type: 'integer', minimum: 0 },
      failedRequests: { type: 'integer', minimum: 0 },
      timeoutRequests: { type: 'integer', minimum: 0 },
      avgLatencyMs: { type: 'integer', minimum: 0 },
      maxLatencyMs: { type: 'integer', minimum: 0 },
      successRate: { type: 'number', minimum: 0, maximum: 100 },
    },
  },
  RpcDebugOptions: {
    type: 'object',
    required: ['projects', 'actions', 'clientIds'],
    properties: {
      projects: {
        type: 'array',
        items: { $ref: '#/components/schemas/Project' },
      },
      actions: { type: 'array', items: { type: 'string' } },
      clientIds: { type: 'array', items: { type: 'string' } },
    },
  },
  InvokeResponse: {
    type: 'object',
    required: [
      'requestId',
      'clientId',
      'is_ok',
      'status',
      'httpCode',
      'latencyMs',
    ],
    properties: {
      requestId: { type: 'string', format: 'uuid' },
      clientId: nullableStringSchema,
      is_ok: { type: 'boolean' },
      status: { type: 'string' },
      httpCode: {
        type: 'integer',
        description: '设备业务结果码；不等同于本次 HTTP 传输状态码。',
      },
      latencyMs: { type: 'integer', minimum: 0 },
      payload: jsonValueSchema,
      error: nullableStringSchema,
    },
  },
  ClientQueueResponse: {
    oneOf: [clientOnlineStatusSchema, projectOnlineDevicesSchema],
  },
  RequestLog: {
    type: 'object',
    required: [
      'id',
      'requestId',
      'projectName',
      'actionName',
      'status',
      'payloadState',
      'createdAt',
    ],
    properties: requestLogProperties,
  },
  RequestLogPage: pageSchema('RequestLog'),
  RequestOptions: {
    type: 'object',
    required: ['projects', 'actions', 'clientIds'],
    properties: {
      projects: { type: 'array', items: { type: 'string' }, maxItems: 200 },
      actions: { type: 'array', items: { type: 'string' }, maxItems: 200 },
      clientIds: { type: 'array', items: { type: 'string' }, maxItems: 200 },
    },
  },
  AppAuditMetadata: {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'value'],
    properties: {
      key: { type: 'string', minLength: 1, maxLength: 100 },
      value: jsonValueSchema,
    },
  },
  AppAuditRequest: {
    type: 'object',
    additionalProperties: false,
    properties: {
      method: { type: 'string', minLength: 1, maxLength: 32 },
      url: { type: 'string', maxLength: 4096 },
      headers: jsonValueSchema,
      body: jsonValueSchema,
    },
  },
  AppAuditResponse: {
    type: 'object',
    additionalProperties: false,
    properties: {
      statusCode: { type: 'integer', minimum: 0, maximum: 999 },
      headers: jsonValueSchema,
      bodyFormat: { type: 'string', enum: ['json', 'text', 'empty'] },
      body: jsonValueSchema,
    },
  },
  AppAuditError: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', maxLength: 100 },
      code: { type: 'string', maxLength: 100 },
      message: { type: 'string', maxLength: 4096 },
    },
  },
  AppAuditStep: {
    type: 'object',
    additionalProperties: false,
    required: ['sequence', 'name', 'startedAt', 'durationMs'],
    properties: {
      sequence: { type: 'integer', minimum: 1, maximum: 128 },
      code: { type: 'string', maxLength: 100 },
      name: { type: 'string', minLength: 1, maxLength: 200 },
      startedAt: dateTimeSchema,
      durationMs: { type: 'number', minimum: 0 },
      status: {
        oneOf: [{ type: 'number' }, { type: 'string', maxLength: 100 }],
      },
      request: { $ref: '#/components/schemas/AppAuditRequest' },
      response: { $ref: '#/components/schemas/AppAuditResponse' },
      error: { $ref: '#/components/schemas/AppAuditError' },
    },
  },
  AppAudit: {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'title', 'metadata', 'steps'],
    properties: {
      schemaVersion: { type: 'integer', enum: [1] },
      title: { type: 'string', minLength: 1, maxLength: 200 },
      metadata: {
        type: 'array',
        maxItems: 64,
        items: { $ref: '#/components/schemas/AppAuditMetadata' },
      },
      steps: {
        type: 'array',
        maxItems: 128,
        items: { $ref: '#/components/schemas/AppAuditStep' },
      },
    },
  },
  RequestDetail: {
    type: 'object',
    required: [
      ...Object.keys(requestLogProperties),
      'payloadUnavailable',
      'requestPayload',
      'responsePayload',
      'appAudit',
    ],
    properties: {
      ...requestLogProperties,
      payloadUnavailable: { type: 'boolean' },
      requestPayload: jsonValueSchema,
      responsePayload: jsonValueSchema,
      appAudit: {
        allOf: [{ $ref: '#/components/schemas/AppAudit' }],
        nullable: true,
      },
    },
  },
  SystemLog: {
    type: 'object',
    required: [
      'id',
      'name',
      'description',
      'actorUserId',
      'actorUsername',
      'action',
      'subject',
      'targetType',
      'metadata',
      'method',
      'route',
      'status',
      'statusCode',
      'createdAt',
    ],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      description: { type: 'string' },
      actorUserId: { type: 'integer' },
      actorUsername: { type: 'string' },
      action: { type: 'string' },
      subject: { type: 'string' },
      targetType: { type: 'string' },
      targetId: nullableStringSchema,
      targetName: nullableStringSchema,
      metadata: { type: 'object', additionalProperties: true },
      method: { type: 'string' },
      route: { type: 'string' },
      status: { type: 'string', enum: ['succeeded', 'failed'] },
      statusCode: { type: 'integer' },
      errorMessage: nullableStringSchema,
      ipAddress: nullableStringSchema,
      userAgent: nullableStringSchema,
      createdAt: dateTimeSchema,
    },
  },
  SystemLogPage: pageSchema('SystemLog'),
  DevicePage: pageSchema('Device'),
  UserPage: pageSchema('User'),
  AccessTokenPage: pageSchema('AccessTokenRecord'),
  DeviceTokenPage: pageSchema('DeviceTokenRecord'),
} satisfies Record<string, SchemaDefinition>;

export function schemaReference(schemaName: string): SchemaDefinition {
  return { $ref: `#/components/schemas/${schemaName}` };
}

export function arraySchemaReference(schemaName: string): SchemaDefinition {
  return {
    type: 'array',
    items: schemaReference(schemaName),
  };
}

export function registerOpenApiResponseSchemas(
  openApiDocument: OpenAPIObject,
): void {
  openApiDocument.components ??= {};
  openApiDocument.components.schemas = {
    ...openApiDocument.components.schemas,
    ...OPEN_API_RESPONSE_SCHEMAS,
  };
}
