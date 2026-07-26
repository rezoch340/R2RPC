import { SetMetadata } from '@nestjs/common';

export const SYSTEM_AUDIT_KEY = 'system-audit';

export interface SystemAuditDefinition {
  name: string;
  action: string;
  subject: string;
  targetType: string;
  actorUsernameBodyField?: string;
  actorUserIdResponsePath?: string;
  actorUsernameResponsePath?: string;
  targetParameter?: string;
  targetNameField?: string;
  targetResponseField?: string;
  metadataParameters?: string[];
  metadataBodyFields?: string[];
  metadataQueryFields?: string[];
  // 成功读取不记审计。仅用于系统日志自身:读它就写它会让日志表被自己的读取污染,
  // 且新记录落在倒序首页,翻页时必然重复。鉴权失败仍然记录(谁在试探审计日志是重要信号)。
  skipSuccessfulRead?: boolean;
}

export const SystemAudit = (definition: SystemAuditDefinition) =>
  SetMetadata(SYSTEM_AUDIT_KEY, definition);
