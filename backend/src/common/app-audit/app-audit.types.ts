export type AppAuditMetadata = {
  key: string;
  value: unknown;
};

export type AppAuditRequest = {
  method?: string;
  url?: string;
  headers?: unknown;
  body?: unknown;
};

export type AppAuditResponse = {
  statusCode?: number;
  headers?: unknown;
  bodyFormat?: 'json' | 'text' | 'empty';
  body?: unknown;
};

export type AppAuditError = {
  type?: string;
  code?: string;
  message?: string;
};

export type AppAuditStep = {
  sequence: number;
  code?: string;
  name: string;
  startedAt: string;
  durationMs: number;
  status?: number | string;
  request?: AppAuditRequest;
  response?: AppAuditResponse;
  error?: AppAuditError;
};

export type AppAudit = {
  schemaVersion: 1;
  title: string;
  metadata: AppAuditMetadata[];
  steps: AppAuditStep[];
};
