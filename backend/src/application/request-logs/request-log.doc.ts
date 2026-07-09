import { RequestLogJob } from './request-log.types';

// 组装 Manticore payload 文档(存完整 request/response 原文)
export function buildManticoreDoc(d: RequestLogJob): Record<string, unknown> {
  return {
    request_id: d.requestId,
    project_name: d.project,
    action_name: d.action,
    client_id: d.clientId ?? '',
    status: d.status,
    http_code: d.httpCode ?? 0,
    latency_ms: d.latencyMs ?? 0,
    created_at: d.createdAt ?? '',
    finished_at: d.finishedAt ?? '',
    request_payload_json: JSON.stringify(d.requestPayload ?? null),
    response_payload_json: JSON.stringify(d.responsePayload ?? null),
    error_message: d.error ?? '',
  };
}
