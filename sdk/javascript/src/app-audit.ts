import type {
  AppAudit,
  AppAuditError,
  AppAuditRequest,
  AppAuditResponse,
  AppAuditStep,
  JsonValue,
} from './types.js';

const MAXIMUM_METADATA_COUNT = 64;
const MAXIMUM_STEP_COUNT = 128;
const MAXIMUM_AUDIT_BYTES = 512 * 1024;

export interface AppAuditStepInput {
  code?: string;
  name: string;
  request?: AppAuditRequest;
  startedAt?: Date;
}

export interface AppAuditStepSuccess {
  status?: number | string;
  response?: AppAuditResponse;
}

export interface AppAuditStepFailure extends AppAuditStepSuccess {
  error: AppAuditError;
}

export class AppAuditStepHandle {
  private completed = false;

  constructor(
    private readonly step: AppAuditStep,
    private readonly startedAtMilliseconds: number,
  ) {}

  succeed(result: AppAuditStepSuccess = {}): void {
    this.complete(result.status, result.response);
  }

  fail(result: AppAuditStepFailure): void {
    this.complete(result.status, result.response, result.error);
  }

  private complete(
    status?: number | string,
    response?: AppAuditResponse,
    error?: AppAuditError,
  ): void {
    if (this.completed) {
      throw new Error(`AppAudit Step 已完成: ${this.step.name}`);
    }
    if (typeof status === 'number' && !Number.isFinite(status)) {
      throw new RangeError('AppAudit Step status 必须是有限数字');
    }
    if (typeof status === 'string' && status.length > 100) {
      throw new RangeError('AppAudit Step status 字符串最多 100 个字符');
    }
    validateResponse(response);
    validateError(error);
    this.completed = true;
    this.step.durationMs = Math.max(
      0,
      Date.now() - this.startedAtMilliseconds,
    );
    if (status !== undefined) {
      this.step.status = status;
    }
    if (response !== undefined) {
      this.step.response = response;
    }
    if (error !== undefined) {
      this.step.error = error;
    }
  }
}

export class AppAuditRecorder {
  private readonly metadata: Array<{ key: string; value: JsonValue }> = [];
  private readonly steps: AppAuditStep[] = [];

  constructor(private readonly title: string) {
    if (!title.trim()) {
      throw new Error('AppAudit title 不能为空');
    }
    if (title.length > 200) {
      throw new RangeError('AppAudit title 最多 200 个字符');
    }
  }

  addMetadata(key: string, value: JsonValue): this {
    if (!key.trim()) {
      throw new Error('AppAudit metadata key 不能为空');
    }
    if (key.length > 100) {
      throw new RangeError('AppAudit metadata key 最多 100 个字符');
    }
    if (this.metadata.length >= MAXIMUM_METADATA_COUNT) {
      throw new Error(`AppAudit metadata 最多 ${MAXIMUM_METADATA_COUNT} 项`);
    }
    this.metadata.push({ key, value });
    return this;
  }

  startStep(input: AppAuditStepInput): AppAuditStepHandle {
    if (!input.name.trim()) {
      throw new Error('AppAudit Step name 不能为空');
    }
    if (input.name.length > 200) {
      throw new RangeError('AppAudit Step name 最多 200 个字符');
    }
    if (input.code !== undefined && input.code.length > 100) {
      throw new RangeError('AppAudit Step code 最多 100 个字符');
    }
    validateRequest(input.request);
    if (this.steps.length >= MAXIMUM_STEP_COUNT) {
      throw new Error(`AppAudit Step 最多 ${MAXIMUM_STEP_COUNT} 项`);
    }
    const startedAt = input.startedAt ?? new Date();
    const step: AppAuditStep = {
      sequence: this.steps.length + 1,
      name: input.name,
      startedAt: startedAt.toISOString(),
      durationMs: 0,
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.request === undefined ? {} : { request: input.request }),
    };
    this.steps.push(step);
    return new AppAuditStepHandle(step, startedAt.getTime());
  }

  snapshot(): AppAudit {
    const snapshot: AppAudit = {
      schemaVersion: 1,
      title: this.title,
      metadata: structuredClone(this.metadata),
      steps: structuredClone(this.steps),
    };
    const encodedBytes = new TextEncoder().encode(
      JSON.stringify(snapshot),
    ).byteLength;
    if (encodedBytes > MAXIMUM_AUDIT_BYTES) {
      throw new RangeError('AppAudit 超过 512 KiB');
    }
    return snapshot;
  }
}

function validateRequest(request: AppAuditRequest | undefined): void {
  if (request?.method !== undefined && !request.method.trim()) {
    throw new TypeError('AppAudit request method 不能为空');
  }
  if (request?.method !== undefined && request.method.length > 32) {
    throw new RangeError('AppAudit request method 最多 32 个字符');
  }
  if (request?.url !== undefined && request.url.length > 4096) {
    throw new RangeError('AppAudit request url 最多 4096 个字符');
  }
}

function validateResponse(response: AppAuditResponse | undefined): void {
  if (
    response?.statusCode !== undefined &&
    (!Number.isInteger(response.statusCode) ||
      response.statusCode < 0 ||
      response.statusCode > 999)
  ) {
    throw new RangeError('AppAudit response statusCode 必须在 0..999');
  }
  if (
    response?.bodyFormat !== undefined &&
    !['json', 'text', 'empty'].includes(response.bodyFormat)
  ) {
    throw new TypeError('AppAudit response bodyFormat 非法');
  }
}

function validateError(error: AppAuditError | undefined): void {
  if (error?.type !== undefined && error.type.length > 100) {
    throw new RangeError('AppAudit error type 最多 100 个字符');
  }
  if (error?.code !== undefined && error.code.length > 100) {
    throw new RangeError('AppAudit error code 最多 100 个字符');
  }
  if (error?.message !== undefined && error.message.length > 4096) {
    throw new RangeError('AppAudit error message 最多 4096 个字符');
  }
}
