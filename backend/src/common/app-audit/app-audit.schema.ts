import { z } from 'zod';
import type { AppAudit } from './app-audit.types';

export const APP_AUDIT_MAX_BYTES = 512 * 1024;
export const APP_AUDIT_MAX_METADATA = 64;
export const APP_AUDIT_MAX_STEPS = 128;

const metadataSchema = z
  .object({
    key: z.string().min(1).max(100),
    value: z.unknown(),
  })
  .strict();

const requestSchema = z
  .object({
    method: z.string().min(1).max(32).optional(),
    url: z.string().max(4096).optional(),
    headers: z.unknown().optional(),
    body: z.unknown().optional(),
  })
  .strict();

const responseSchema = z
  .object({
    statusCode: z.number().int().min(0).max(999).optional(),
    headers: z.unknown().optional(),
    bodyFormat: z.enum(['json', 'text', 'empty']).optional(),
    body: z.unknown().optional(),
  })
  .strict();

const errorSchema = z
  .object({
    type: z.string().max(100).optional(),
    code: z.string().max(100).optional(),
    message: z.string().max(4096).optional(),
  })
  .strict();

const stepSchema = z
  .object({
    sequence: z.number().int().positive().max(APP_AUDIT_MAX_STEPS),
    code: z.string().max(100).optional(),
    name: z.string().min(1).max(200),
    startedAt: z.iso.datetime({ offset: true }),
    durationMs: z.number().finite().nonnegative(),
    status: z.union([z.number().finite(), z.string().max(100)]).optional(),
    request: requestSchema.optional(),
    response: responseSchema.optional(),
    error: errorSchema.optional(),
  })
  .strict();

const appAuditSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().min(1).max(200),
    metadata: z.array(metadataSchema).max(APP_AUDIT_MAX_METADATA),
    steps: z.array(stepSchema).max(APP_AUDIT_MAX_STEPS),
  })
  .strict();

export type AppAuditValidation =
  { success: true; data: AppAudit } | { success: false; reason: string };

// 设备输入不可信：整个审计必须通过 V1 契约、连续序号和独立体积限制。
export function validateDeviceAppAudit(input: unknown): AppAuditValidation {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return { success: false, reason: '不是可序列化 JSON' };
  }
  if (!encoded) {
    return { success: false, reason: '审计为空' };
  }
  if (Buffer.byteLength(encoded, 'utf8') > APP_AUDIT_MAX_BYTES) {
    return { success: false, reason: '超过 512 KiB' };
  }

  const parsed = appAuditSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      reason: issue
        ? `${issue.path.join('.') || 'appAudit'}: ${issue.message}`
        : '结构非法',
    };
  }
  const wrongSequence = parsed.data.steps.findIndex(
    (step, index) => step.sequence !== index + 1,
  );
  if (wrongSequence >= 0) {
    return {
      success: false,
      reason: `steps.${wrongSequence}.sequence 必须为 ${wrongSequence + 1}`,
    };
  }
  return { success: true, data: parsed.data };
}
