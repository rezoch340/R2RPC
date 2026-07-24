import type { AuthedRequest } from '../types/authed-request';
import type { CreateSystemLogInput } from '../../application/system-logs/entity/model';
import type { SystemAuditDefinition } from '../decorators/system-audit.decorator';

interface BuildSystemAuditEntryInput {
  definition: SystemAuditDefinition;
  request: AuthedRequest;
  responseBody?: unknown;
  status: 'succeeded' | 'failed';
  statusCode: number;
  errorMessage?: string;
}

function readObjectField(input: unknown, fieldName?: string): unknown {
  if (!fieldName || typeof input !== 'object' || input === null) {
    return undefined;
  }
  return fieldName in input
    ? (input as Record<string, unknown>)[fieldName]
    : undefined;
}

function readObjectPath(input: unknown, fieldPath?: string): unknown {
  if (!fieldPath) {
    return undefined;
  }
  let currentValue = input;
  for (const fieldName of fieldPath.split('.')) {
    currentValue = readObjectField(currentValue, fieldName);
    if (currentValue === undefined) {
      return undefined;
    }
  }
  return currentValue;
}

function toIdentifier(input: unknown): string | null {
  if (typeof input === 'string' && input.length > 0) {
    return input.slice(0, 128);
  }
  if (typeof input === 'number' && Number.isFinite(input)) {
    return String(input);
  }
  return null;
}

function safeMetadataValue(input: unknown): unknown {
  if (
    typeof input === 'string' ||
    typeof input === 'number' ||
    typeof input === 'boolean' ||
    input === null
  ) {
    return typeof input === 'string' ? input.slice(0, 512) : input;
  }
  if (Array.isArray(input)) {
    const safeValues = input
      .map((item) => safeMetadataValue(item))
      .filter((item) => item !== undefined);
    return safeValues.length === input.length ? safeValues : undefined;
  }
  return undefined;
}

function collectMetadata(
  definition: SystemAuditDefinition,
  request: AuthedRequest,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const fieldName of definition.metadataParameters ?? []) {
    const value = safeMetadataValue(readObjectField(request.params, fieldName));
    if (value !== undefined) {
      metadata[fieldName] = value;
    }
  }
  for (const fieldName of definition.metadataBodyFields ?? []) {
    const value = safeMetadataValue(readObjectField(request.body, fieldName));
    if (value !== undefined) {
      metadata[fieldName] = value;
    }
  }
  for (const fieldName of definition.metadataQueryFields ?? []) {
    const value = safeMetadataValue(readObjectField(request.query, fieldName));
    if (value !== undefined) {
      metadata[fieldName] = value;
    }
  }
  return metadata;
}

function formatMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata);
  if (entries.length === 0) {
    return '';
  }
  const text = entries
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(', ');
  return ` (${text})`;
}

function buildDescription(input: {
  actorUsername: string;
  definition: SystemAuditDefinition;
  targetId: string | null;
  targetName: string | null;
  metadata: Record<string, unknown>;
  status: 'succeeded' | 'failed';
}): string {
  const target = input.targetName ?? input.targetId;
  const targetText = target ? ` ${target}` : '';
  const metadataText = formatMetadata(input.metadata);
  const statusText = input.status === 'failed' ? ' [失败]' : '';
  return `${input.actorUsername} ${input.definition.name}${targetText}${metadataText}${statusText}`.slice(
    0,
    1024,
  );
}

function forwardedAddress(request: AuthedRequest): string | null {
  const forwardedHeader = request.headers['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwardedHeader)
    ? forwardedHeader[0]
    : forwardedHeader;
  return (
    forwardedValue?.split(',')[0]?.trim() ??
    request.ip ??
    request.socket.remoteAddress ??
    null
  );
}

function resolveTargetId(
  definition: SystemAuditDefinition,
  request: AuthedRequest,
  responseBody: unknown,
): string | null {
  const parameterValue = definition.targetParameter
    ? readObjectField(request.params, definition.targetParameter)
    : undefined;
  return (
    toIdentifier(parameterValue) ??
    toIdentifier(readObjectField(responseBody, definition.targetResponseField))
  );
}

function resolveTargetName(
  definition: SystemAuditDefinition,
  request: AuthedRequest,
  responseBody: unknown,
): string | null {
  const bodyValue = definition.targetNameField
    ? readObjectField(request.body, definition.targetNameField)
    : undefined;
  return (
    toIdentifier(bodyValue) ??
    toIdentifier(readObjectField(responseBody, definition.targetNameField))
  );
}

function userAgentOf(request: AuthedRequest): string | null {
  const userAgent = request.headers['user-agent'];
  return typeof userAgent === 'string' ? userAgent.slice(0, 512) : null;
}

function actorIdentity(
  definition: SystemAuditDefinition,
  request: AuthedRequest,
  responseBody: unknown,
): { userId: number; username: string } {
  const responseUserId = readObjectPath(
    responseBody,
    definition.actorUserIdResponsePath,
  );
  const responseUsername = toIdentifier(
    readObjectPath(responseBody, definition.actorUsernameResponsePath),
  );
  const bodyUsername = toIdentifier(
    readObjectField(request.body, definition.actorUsernameBodyField),
  );
  return {
    userId:
      request.user?.id ??
      (typeof responseUserId === 'number' &&
      Number.isInteger(responseUserId) &&
      responseUserId > 0
        ? responseUserId
        : 0),
    username:
      request.user?.username ?? responseUsername ?? bodyUsername ?? 'anonymous',
  };
}

export function buildSystemAuditEntry(
  input: BuildSystemAuditEntryInput,
): CreateSystemLogInput {
  const targetId = resolveTargetId(
    input.definition,
    input.request,
    input.responseBody,
  );
  const targetName = resolveTargetName(
    input.definition,
    input.request,
    input.responseBody,
  );
  const metadata = collectMetadata(input.definition, input.request);
  const actor = actorIdentity(
    input.definition,
    input.request,
    input.responseBody,
  );
  return {
    name: input.definition.name,
    description: buildDescription({
      actorUsername: actor.username,
      definition: input.definition,
      targetId,
      targetName,
      metadata,
      status: input.status,
    }),
    actorUserId: actor.userId,
    actorUsername: actor.username,
    action: input.definition.action,
    subject: input.definition.subject,
    targetType: input.definition.targetType,
    targetId,
    targetName,
    metadata,
    method: input.request.method,
    route: input.request.originalUrl.split('?')[0] ?? input.request.originalUrl,
    status: input.status,
    statusCode: input.statusCode,
    errorMessage: input.errorMessage?.slice(0, 1024) ?? null,
    ipAddress: forwardedAddress(input.request),
    userAgent: userAgentOf(input.request),
  };
}
