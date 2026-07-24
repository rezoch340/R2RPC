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
    return input;
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
    const value = safeMetadataValue(request.params[fieldName]);
    if (value !== undefined) {
      metadata[fieldName] = value;
    }
  }
  for (const fieldName of definition.metadataBodyFields ?? []) {
    const value = safeMetadataValue(request.body[fieldName]);
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
    ? request.params[definition.targetParameter]
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
    ? request.body[definition.targetNameField]
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
  const actorUsername = input.request.user?.username ?? 'unknown';
  return {
    name: input.definition.name,
    description: buildDescription({
      actorUsername,
      definition: input.definition,
      targetId,
      targetName,
      metadata,
      status: input.status,
    }),
    actorUserId: input.request.user?.id ?? 0,
    actorUsername,
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
