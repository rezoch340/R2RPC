import {
  describe,
  expect,
  it as testCase,
  vi as vitest,
} from 'vitest';
import { AppAuditRecorder } from '../src/index.js';

describe('AppAuditRecorder', () => {
  testCase('生成连续 Step 并防止重复完成', () => {
    vitest.useFakeTimers();
    vitest.setSystemTime(new Date('2026-07-24T12:00:00.000Z'));
    const recorder = new AppAuditRecorder('设备执行链路').addMetadata(
      'device',
      'device-001',
    );
    const step = recorder.startStep({
      code: 'hello',
      name: '处理 Hello',
      request: { method: 'LOCAL', body: { message: 'hello' } },
    });
    vitest.advanceTimersByTime(35);
    step.succeed({
      status: 200,
      response: {
        statusCode: 200,
        bodyFormat: 'json',
        body: { message: 'hello' },
      },
    });

    expect(recorder.snapshot()).toEqual({
      schemaVersion: 1,
      title: '设备执行链路',
      metadata: [{ key: 'device', value: 'device-001' }],
      steps: [
        expect.objectContaining({
          sequence: 1,
          code: 'hello',
          durationMs: 35,
          status: 200,
        }),
      ],
    });
    expect(() => step.succeed()).toThrow('已完成');
    vitest.useRealTimers();
  });

  testCase('拒绝超过 512 KiB 的快照', () => {
    const recorder = new AppAuditRecorder('large audit').addMetadata(
      'payload',
      'x'.repeat(513 * 1024),
    );

    expect(() => recorder.snapshot()).toThrow('超过 512 KiB');
  });
});
