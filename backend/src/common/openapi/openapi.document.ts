import type { OpenAPIObject } from '@nestjs/swagger';
import {
  ACCESS_TOKEN_SECURITY_NAME,
  ADMINISTRATOR_JWT_SECURITY_NAME,
} from './openapi.configuration';
import {
  CONFLICT_OPERATION_IDS,
  NOT_FOUND_OPERATION_IDS,
  OPEN_API_SUCCESS_SCHEMAS,
} from './openapi.responses';
import {
  registerOpenApiResponseSchemas,
  schemaReference,
} from './openapi.schemas';

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'options',
  'head',
  'trace',
] as const;

type PathItem = OpenAPIObject['paths'][string];
type Operation = NonNullable<PathItem['get']>;
type ResponseDefinition = NonNullable<Operation['responses'][string]>;

const ACCESS_TOKEN_OPERATION_IDS = new Set([
  'RpcController_invoke',
  'RpcController_clientQueue',
]);

const PUBLIC_OPERATION_IDS = new Set(['AuthController_login']);

const STANDARD_ERROR_RESPONSES: Record<string, ResponseDefinition> = {
  BadRequest: errorResponse('请求参数、路径参数或查询参数不符合契约。'),
  Unauthorized: errorResponse('凭证缺失、无效、过期、撤销或对应账号已不存在。'),
  Forbidden: errorResponse(
    '凭证有效，但账号、功能组或 RBAC 权限不允许本次操作。',
  ),
  NotFound: errorResponse('目标资源不存在或已被软删除。'),
  Conflict: errorResponse('资源名称或关联关系与现有数据冲突。'),
  TooManyRequests: errorResponse('Access Token 的 RPC 调用次数已经用尽。'),
  InternalServerError: errorResponse('服务端发生未预期错误。'),
};

function errorResponse(description: string): ResponseDefinition {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaReference('ErrorResponse'),
      },
    },
  };
}

function responseReference(responseName: string): ResponseDefinition {
  return { $ref: `#/components/responses/${responseName}` };
}

function operationEntries(pathItem: PathItem): Operation[] {
  return HTTP_METHODS.flatMap((method) => {
    const operation = pathItem[method];
    return operation ? [operation] : [];
  });
}

function authenticationDescription(operationId: string): string {
  if (PUBLIC_OPERATION_IDS.has(operationId)) {
    return '本接口无需预先提供凭证。';
  }
  if (ACCESS_TOKEN_OPERATION_IDS.has(operationId)) {
    return '使用 Authorization: Bearer rk_… 访问令牌，并校验功能组作用域。';
  }
  return '使用后台 JWT，并校验当前账号状态及对应 RBAC 权限。';
}

function applyOperationSecurity(
  operation: Operation,
  operationId: string,
): void {
  if (PUBLIC_OPERATION_IDS.has(operationId)) {
    operation.security = [];
    return;
  }
  const securityName = ACCESS_TOKEN_OPERATION_IDS.has(operationId)
    ? ACCESS_TOKEN_SECURITY_NAME
    : ADMINISTRATOR_JWT_SECURITY_NAME;
  operation.security = [{ [securityName]: [] }];
}

function applySuccessResponse(operation: Operation, operationId: string): void {
  const successSchema = OPEN_API_SUCCESS_SCHEMAS[operationId];
  if (!successSchema) {
    throw new Error(`OpenAPI 缺少成功响应契约: ${operationId}`);
  }
  const successStatus = Object.keys(operation.responses).find((status) =>
    /^2\d\d$/.test(status),
  );
  if (!successStatus) {
    throw new Error(`OpenAPI 缺少成功状态码: ${operationId}`);
  }
  operation.responses[successStatus] = {
    description: `${operation.summary ?? operationId}成功。`,
    content: {
      'application/json': {
        schema: successSchema,
      },
    },
  };
}

function applyErrorResponses(operation: Operation, operationId: string): void {
  operation.responses['400'] = responseReference('BadRequest');
  operation.responses['500'] = responseReference('InternalServerError');
  if (!PUBLIC_OPERATION_IDS.has(operationId)) {
    operation.responses['401'] = responseReference('Unauthorized');
    operation.responses['403'] = responseReference('Forbidden');
  }
  if (operationId === 'AuthController_login') {
    operation.responses['401'] = responseReference('Unauthorized');
    operation.responses['403'] = responseReference('Forbidden');
  }
  if (NOT_FOUND_OPERATION_IDS.has(operationId)) {
    operation.responses['404'] = responseReference('NotFound');
  }
  if (CONFLICT_OPERATION_IDS.has(operationId)) {
    operation.responses['409'] = responseReference('Conflict');
  }
  if (operationId === 'RpcController_invoke') {
    operation.responses['429'] = responseReference('TooManyRequests');
  }
}

function completeOperation(operation: Operation): void {
  const operationId = operation.operationId;
  if (!operationId) {
    throw new Error('OpenAPI 操作缺少 operationId');
  }
  operation.description = `${operation.summary ?? operationId}。${authenticationDescription(operationId)}`;
  applyOperationSecurity(operation, operationId);
  applySuccessResponse(operation, operationId);
  applyErrorResponses(operation, operationId);
}

function registerStandardResponses(openApiDocument: OpenAPIObject): void {
  openApiDocument.components ??= {};
  openApiDocument.components.responses = {
    ...openApiDocument.components.responses,
    ...STANDARD_ERROR_RESPONSES,
  };
}

function assertOperationCoverage(openApiDocument: OpenAPIObject): void {
  const generatedOperationIds = new Set(
    Object.values(openApiDocument.paths)
      .flatMap(operationEntries)
      .map((operation) => operation.operationId)
      .filter((operationId): operationId is string => !!operationId),
  );
  const unknownMappings = Object.keys(OPEN_API_SUCCESS_SCHEMAS).filter(
    (operationId) => !generatedOperationIds.has(operationId),
  );
  if (unknownMappings.length > 0) {
    throw new Error(
      `OpenAPI 成功响应映射包含已不存在的操作: ${unknownMappings.join(', ')}`,
    );
  }
}

function assertCompletedOperation(operation: Operation): void {
  const operationId = operation.operationId ?? 'unknown';
  if (!operation.description) {
    throw new Error(`OpenAPI 操作缺少 description: ${operationId}`);
  }
  const successResponse = Object.entries(operation.responses).find(([status]) =>
    /^2\d\d$/.test(status),
  )?.[1];
  if (!successResponse || '$ref' in successResponse) {
    throw new Error(`OpenAPI 操作缺少成功响应对象: ${operationId}`);
  }
  if (!successResponse.content?.['application/json']?.schema) {
    throw new Error(`OpenAPI 操作缺少成功响应 schema: ${operationId}`);
  }
  if (
    !Object.keys(operation.responses).some((status) => /^4\d\d$/.test(status))
  ) {
    throw new Error(`OpenAPI 操作缺少 4xx 响应: ${operationId}`);
  }
  assertOperationSecurity(operation, operationId);
}

function assertOperationSecurity(
  operation: Operation,
  operationId: string,
): void {
  if (operation.security === undefined) {
    throw new Error(`OpenAPI 操作缺少明确鉴权方案: ${operationId}`);
  }
}

function assertCompletedDocument(openApiDocument: OpenAPIObject): void {
  if (!openApiDocument.servers?.length) {
    throw new Error('OpenAPI 缺少 servers');
  }
  const securitySchemes = openApiDocument.components?.securitySchemes ?? {};
  if (
    !securitySchemes[ADMINISTRATOR_JWT_SECURITY_NAME] ||
    !securitySchemes[ACCESS_TOKEN_SECURITY_NAME]
  ) {
    throw new Error('OpenAPI 缺少后台 JWT 或 Access Token 安全方案');
  }
  for (const pathItem of Object.values(openApiDocument.paths)) {
    for (const operation of operationEntries(pathItem)) {
      assertCompletedOperation(operation);
    }
  }
}

export function completeOpenApiDocument(
  openApiDocument: OpenAPIObject,
): OpenAPIObject {
  registerOpenApiResponseSchemas(openApiDocument);
  registerStandardResponses(openApiDocument);
  for (const pathItem of Object.values(openApiDocument.paths)) {
    for (const operation of operationEntries(pathItem)) {
      completeOperation(operation);
    }
  }
  assertOperationCoverage(openApiDocument);
  assertCompletedDocument(openApiDocument);
  return openApiDocument;
}
