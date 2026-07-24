import { RequestLogJob } from './request-log.types';

// 组装 Manticore payload 文档(存完整 request/response 原文)
export function buildManticoreDoc(
  requestLog: RequestLogJob,
): Record<string, unknown> {
  return {
    request_id: requestLog.requestId,
    project_name: requestLog.project,
    action_name: requestLog.action,
    client_id: requestLog.clientId ?? '',
    status: requestLog.status,
    http_code: requestLog.httpCode ?? 0,
    latency_ms: requestLog.latencyMs ?? 0,
    created_at: requestLog.createdAt ?? '',
    finished_at: requestLog.finishedAt ?? '',
    request_payload_json: JSON.stringify(requestLog.requestPayload ?? null),
    response_payload_json: JSON.stringify(requestLog.responsePayload ?? null),
    app_audit_json: JSON.stringify(requestLog.appAudit ?? null),
    error_message: requestLog.error ?? '',
  };
}
