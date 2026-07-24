import { SetMetadata } from '@nestjs/common';

export const SYSTEM_AUDIT_KEY = 'system-audit';

export interface SystemAuditDefinition {
  name: string;
  action: string;
  subject: string;
  targetType: string;
  targetParameter?: string;
  targetNameField?: string;
  targetResponseField?: string;
  metadataParameters?: string[];
  metadataBodyFields?: string[];
}

export const SystemAudit = (definition: SystemAuditDefinition) =>
  SetMetadata(SYSTEM_AUDIT_KEY, definition);
