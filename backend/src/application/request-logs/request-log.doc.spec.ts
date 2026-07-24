import type { RequestLogJob } from './request-log.types';
import { buildManticoreDoc } from './request-log.doc';

describe('请求日志 Manticore 文档', () => {
  it('分别序列化业务 payload 和设备 AppAudit', () => {
    const appAudit = {
      schemaVersion: 1 as const,
      title: '设备执行链路',
      metadata: [],
      steps: [
        {
          sequence: 1,
          name: '查询上游',
          startedAt: '2026-07-24T12:00:00.000Z',
          durationMs: 12,
          status: 200,
        },
      ],
    };
    const job: RequestLogJob = {
      requestId: 'request-fixture',
      project: 'project-fixture',
      action: 'action-fixture',
      clientId: 'device-fixture',
      requesterUserId: null,
      accessTokenId: 1,
      status: 'ok',
      httpCode: 200,
      latencyMs: 20,
      error: null,
      requestPayload: { input: true },
      responsePayload: { output: true },
      appAudit,
      createdAt: '2026-07-24T12:00:00.000Z',
      finishedAt: '2026-07-24T12:00:00.020Z',
    };

    const searchDocument = buildManticoreDoc(job);
    expect(JSON.parse(String(searchDocument.request_payload_json))).toEqual({
      input: true,
    });
    expect(JSON.parse(String(searchDocument.response_payload_json))).toEqual({
      output: true,
    });
    expect(JSON.parse(String(searchDocument.app_audit_json))).toEqual(appAudit);
  });
});
