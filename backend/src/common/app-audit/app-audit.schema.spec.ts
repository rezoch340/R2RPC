import {
  APP_AUDIT_MAX_STEPS,
  validateDeviceAppAudit,
} from './app-audit.schema';

const validAudit = () => ({
  schemaVersion: 1,
  title: '设备执行链路',
  metadata: [{ key: '租户', value: 'tenant-fixture' }],
  steps: [
    {
      sequence: 1,
      code: 'lookup',
      name: '查询上游',
      startedAt: '2026-07-24T12:00:00.000Z',
      durationMs: 35,
      status: 200,
      request: {
        method: 'POST',
        url: 'https://example.test/lookup',
        headers: { 'content-type': 'application/json' },
        body: { id: 'fixture' },
      },
      response: {
        statusCode: 200,
        bodyFormat: 'json',
        body: { ok: true },
      },
    },
  ],
});

describe('设备 AppAudit V1 校验', () => {
  it('接受 FlowCore 兼容的 metadata、请求和响应 Step', () => {
    const result = validateDeviceAppAudit(validAudit());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validAudit());
    }
  });

  it('拒绝不连续的 sequence', () => {
    const audit = validAudit();
    audit.steps[0].sequence = 2;
    const result = validateDeviceAppAudit(audit);
    expect(result).toEqual({
      success: false,
      reason: 'steps.0.sequence 必须为 1',
    });
  });

  it('拒绝未知字段和不支持的 schemaVersion', () => {
    expect(
      validateDeviceAppAudit({ ...validAudit(), deviceOverride: true }).success,
    ).toBe(false);
    expect(
      validateDeviceAppAudit({ ...validAudit(), schemaVersion: 2 }).success,
    ).toBe(false);
  });

  it('拒绝 Step 数量和总体积超限', () => {
    const tooMany = validAudit();
    tooMany.steps = Array.from(
      { length: APP_AUDIT_MAX_STEPS + 1 },
      (unusedValue, index) => {
        void unusedValue;
        return {
          ...validAudit().steps[0],
          sequence: index + 1,
        };
      },
    );
    expect(validateDeviceAppAudit(tooMany).success).toBe(false);

    const tooLarge = validAudit();
    tooLarge.metadata[0].value = 'x'.repeat(512 * 1024);
    expect(validateDeviceAppAudit(tooLarge)).toEqual({
      success: false,
      reason: '超过 512 KiB',
    });
  });
});
