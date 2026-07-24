export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObjectValue = { [key: string]: JsonValue };

export interface AppAuditMetadata {
  key: string;
  value: JsonValue;
}

export interface AppAuditRequest {
  method?: string;
  url?: string;
  headers?: JsonValue;
  body?: JsonValue;
}

export interface AppAuditResponse {
  statusCode?: number;
  headers?: JsonValue;
  bodyFormat?: 'json' | 'text' | 'empty';
  body?: JsonValue;
}

export interface AppAuditError {
  type?: string;
  code?: string;
  message?: string;
}

export interface AppAuditStep {
  sequence: number;
  code?: string;
  name: string;
  startedAt: string;
  durationMs: number;
  status?: number | string;
  request?: AppAuditRequest;
  response?: AppAuditResponse;
  error?: AppAuditError;
}

export interface AppAudit {
  schemaVersion: 1;
  title: string;
  metadata: AppAuditMetadata[];
  steps: AppAuditStep[];
}

export interface RpcJob {
  type: 'job';
  requestId: string;
  project: string;
  action: string;
  payload: JsonValue;
  timeoutSeconds: number;
  deadlineAt?: number;
}

export interface DeviceActionResult {
  payload?: JsonValue;
  status?: string;
  isOk?: boolean;
  httpCode?: number;
  error?: string;
  appAudit?: AppAudit;
}

export type DeviceActionHandler = (
  job: RpcJob,
) => DeviceActionResult | Promise<DeviceActionResult>;

export interface RpcInvokeOptions {
  clientId?: string;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

export interface RpcResponse {
  requestId: string;
  clientId: string | null;
  is_ok: boolean;
  status: string;
  httpCode: number;
  latencyMs: number;
  payload?: JsonValue;
  error?: string;
}

export interface ProjectOnlineDevices {
  project: string;
  online: string[];
}

export interface DeviceOnlineStatus {
  clientId: string;
  online: boolean;
}

export type DeviceConnectionState =
  | 'idle'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'stopped';

export interface DeviceWelcome {
  type: 'welcome';
  clientId: string;
  projects: number[];
  maxInFlight: number;
}

export interface DeviceConnectionEvent {
  state: DeviceConnectionState;
  reconnectAttempt: number;
}
