import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadApplicationConfiguration } from '../infrastructure/config/config.loader';
import type { AppConfig } from '../infrastructure/config/config.schema';
import {
  preparePerformanceFixture,
  type PerformanceFixture,
} from './performance-fixture';

interface PerformanceScenarioRequest {
  path: string;
  authenticationToken: string;
  body?: Record<string, unknown>;
  validateResponse?: (responseBody: unknown) => boolean;
}

interface PerformanceRequestScenario {
  name: string;
  method: 'GET' | 'POST';
  createRequest: () => PerformanceScenarioRequest;
}

interface RequestMeasurement {
  scenarioName: string;
  statusCode: number;
  latencyMilliseconds: number;
  succeeded: boolean;
  routedClientId?: string;
  error?: string;
}

interface PerformancePhaseInput {
  baseUrl: string;
  durationSeconds: number;
  concurrency: number;
  targetRequestsPerSecond: number;
  requestTimeoutMilliseconds: number;
  scenarios: PerformanceRequestScenario[];
}

interface PerformanceScenarioSummary {
  name: string;
  requests: number;
  failures: number;
  errorRate: number;
  averageLatencyMilliseconds: number;
  percentile50LatencyMilliseconds: number;
  percentile95LatencyMilliseconds: number;
  percentile99LatencyMilliseconds: number;
  statusCodes: Record<string, number>;
  routedDeviceCounts: Record<string, number>;
}

interface MeasuredPerformancePhase {
  measurements: RequestMeasurement[];
  elapsedMilliseconds: number;
}

type PerformanceConfiguration = AppConfig['performance'];

function sleep(milliseconds: number): Promise<void> {
  return new Promise((completeSleep) =>
    setTimeout(completeSleep, milliseconds),
  );
}

async function readAuthenticationToken(
  baseUrl: string,
  username: string,
  password: string,
  requestTimeoutMilliseconds: number,
): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
  const responseBody: unknown = await response.json();
  const authenticationToken =
    responseBody && typeof responseBody === 'object'
      ? (responseBody as { token?: unknown }).token
      : undefined;
  if (!response.ok || typeof authenticationToken !== 'string') {
    throw new Error(`性能测试登录失败: HTTP ${response.status}`);
  }
  return authenticationToken;
}

function readScenarioResponse(responseText: string): unknown {
  if (!responseText) {
    return undefined;
  }
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function readRoutedClientId(responseBody: unknown): string | undefined {
  if (!isObjectRecord(responseBody)) {
    return undefined;
  }
  const routedClientId = responseBody.clientId;
  return typeof routedClientId === 'string' ? routedClientId : undefined;
}

function isObjectRecord(
  candidateValue: unknown,
): candidateValue is Record<string, unknown> {
  return candidateValue !== null && typeof candidateValue === 'object';
}

function isHelloPayload(payload: unknown, clientId: string): boolean {
  if (!isObjectRecord(payload)) {
    return false;
  }
  if (payload.message !== 'hello') {
    return false;
  }
  return payload.deviceClientId === clientId;
}

function isSuccessfulHelloResponse(
  responseBody: unknown,
  allowedClientIds: string[],
  expectedClientId?: string,
): boolean {
  if (!isObjectRecord(responseBody)) {
    return false;
  }
  if (responseBody.is_ok !== true) {
    return false;
  }
  if (responseBody.status !== 'ok') {
    return false;
  }
  if (typeof responseBody.clientId !== 'string') {
    return false;
  }
  if (!allowedClientIds.includes(responseBody.clientId)) {
    return false;
  }
  if (expectedClientId && responseBody.clientId !== expectedClientId) {
    return false;
  }
  return isHelloPayload(responseBody.payload, responseBody.clientId);
}

function createReadScenario(
  name: string,
  path: string,
  administratorToken: string,
): PerformanceRequestScenario {
  return {
    name,
    method: 'GET',
    createRequest: () => ({
      path,
      authenticationToken: administratorToken,
    }),
  };
}

function helloRequestBody(routeMode: string): Record<string, unknown> {
  return {
    timeoutSeconds: 2,
    payload: {
      message: 'hello',
      routeMode,
      source: 'docker-performance-suite',
    },
  };
}

function buildPerformanceScenarios(
  administratorToken: string,
  fixture: PerformanceFixture,
  projectName: string,
): PerformanceRequestScenario[] {
  const allowedClientIds = fixture.devicePool.clientIds;
  return [
    createReadScenario('读取认证信息', '/auth/me', administratorToken),
    createReadScenario('读取概览指标', '/metrics/overview', administratorToken),
    createReadScenario('读取功能组', '/projects', administratorToken),
    createReadScenario(
      '读取设备',
      '/devices?page=1&pageSize=10',
      administratorToken,
    ),
    createReadScenario(
      '读取请求日志',
      '/monitor/requests?page=1&pageSize=10',
      administratorToken,
    ),
    createReadScenario(
      '读取系统日志',
      '/system-logs?page=1&pageSize=10',
      administratorToken,
    ),
    createReadScenario('读取权限组', '/rbac/roles', administratorToken),
    {
      name: '手动 RPC 自动路由 Hello',
      method: 'POST',
      createRequest: () => ({
        path: `/rpc/debug/invoke/${encodeURIComponent(projectName)}/hello`,
        authenticationToken: administratorToken,
        body: helloRequestBody('manual-automatic'),
        validateResponse: (responseBody) =>
          isSuccessfulHelloResponse(responseBody, allowedClientIds),
      }),
    },
    {
      name: 'Access Token 自动轮询 Hello',
      method: 'POST',
      createRequest: () => ({
        path: `/rpc/invoke/${encodeURIComponent(projectName)}/hello`,
        authenticationToken: fixture.accessToken,
        body: helloRequestBody('access-token-automatic'),
        validateResponse: (responseBody) =>
          isSuccessfulHelloResponse(responseBody, allowedClientIds),
      }),
    },
    {
      name: 'Access Token 随机指定设备 Hello',
      method: 'POST',
      createRequest: () => {
        const selectedClientId = fixture.devicePool.randomClientId();
        return {
          path:
            `/rpc/invoke/${encodeURIComponent(projectName)}/hello` +
            `?clientId=${encodeURIComponent(selectedClientId)}`,
          authenticationToken: fixture.accessToken,
          body: helloRequestBody('access-token-random-device'),
          validateResponse: (responseBody) =>
            isSuccessfulHelloResponse(
              responseBody,
              allowedClientIds,
              selectedClientId,
            ),
        };
      },
    },
  ];
}

async function executeScenario(
  baseUrl: string,
  scenario: PerformanceRequestScenario,
  requestTimeoutMilliseconds: number,
): Promise<RequestMeasurement> {
  const startedAt = performance.now();
  const scenarioRequest = scenario.createRequest();
  try {
    const response = await fetch(`${baseUrl}${scenarioRequest.path}`, {
      method: scenario.method,
      headers: {
        authorization: `Bearer ${scenarioRequest.authenticationToken}`,
        ...(scenarioRequest.body ? { 'content-type': 'application/json' } : {}),
      },
      body: scenarioRequest.body
        ? JSON.stringify(scenarioRequest.body)
        : undefined,
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
    const responseBody = readScenarioResponse(await response.text());
    const responseContractPassed =
      !scenarioRequest.validateResponse ||
      scenarioRequest.validateResponse(responseBody);
    return {
      scenarioName: scenario.name,
      statusCode: response.status,
      latencyMilliseconds: performance.now() - startedAt,
      succeeded: response.ok && responseContractPassed,
      routedClientId: readRoutedClientId(responseBody),
      ...(!responseContractPassed
        ? { error: '业务响应未通过性能场景契约校验' }
        : {}),
    };
  } catch (error) {
    return {
      scenarioName: scenario.name,
      statusCode: 0,
      latencyMilliseconds: performance.now() - startedAt,
      succeeded: false,
      error: (error as Error).message,
    };
  }
}

async function runPerformanceWorker(
  workerIndex: number,
  phaseStartedAt: number,
  phaseDeadline: number,
  input: PerformancePhaseInput,
): Promise<RequestMeasurement[]> {
  const measurements: RequestMeasurement[] = [];
  const requestSpacingMilliseconds = 1000 / input.targetRequestsPerSecond;
  const workerIntervalMilliseconds =
    requestSpacingMilliseconds * input.concurrency;
  let scheduledAt = phaseStartedAt + workerIndex * requestSpacingMilliseconds;
  let scenarioIndex = workerIndex;

  while (scheduledAt < phaseDeadline) {
    const waitingMilliseconds = scheduledAt - Date.now();
    if (waitingMilliseconds > 0) {
      await sleep(waitingMilliseconds);
    }
    if (Date.now() >= phaseDeadline) {
      break;
    }
    const scenario = input.scenarios[scenarioIndex % input.scenarios.length];
    measurements.push(
      await executeScenario(
        input.baseUrl,
        scenario,
        input.requestTimeoutMilliseconds,
      ),
    );
    scheduledAt += workerIntervalMilliseconds;
    scenarioIndex += input.concurrency;
  }
  return measurements;
}

async function runPerformancePhase(
  input: PerformancePhaseInput,
): Promise<MeasuredPerformancePhase> {
  const phaseStartedAt = Date.now();
  const phaseDeadline = phaseStartedAt + input.durationSeconds * 1000;
  const workerMeasurements = await Promise.all(
    Array.from({ length: input.concurrency }, (unusedValue, workerIndex) =>
      runPerformanceWorker(workerIndex, phaseStartedAt, phaseDeadline, input),
    ),
  );
  return {
    measurements: workerMeasurements.flat(),
    elapsedMilliseconds: Date.now() - phaseStartedAt,
  };
}

function calculatePercentile(
  latencyValues: number[],
  percentile: number,
): number {
  if (latencyValues.length === 0) {
    return 0;
  }
  const sortedLatencyValues = [...latencyValues].sort(
    (leftValue, rightValue) => leftValue - rightValue,
  );
  const percentileIndex = Math.min(
    sortedLatencyValues.length - 1,
    Math.ceil(percentile * sortedLatencyValues.length) - 1,
  );
  return sortedLatencyValues[percentileIndex];
}

function countRoutedDevices(
  measurements: RequestMeasurement[],
): Record<string, number> {
  const routedDeviceCounts: Record<string, number> = {};
  for (const measurement of measurements) {
    if (!measurement.routedClientId) {
      continue;
    }
    routedDeviceCounts[measurement.routedClientId] =
      (routedDeviceCounts[measurement.routedClientId] ?? 0) + 1;
  }
  return routedDeviceCounts;
}

function buildScenarioSummary(
  scenarioName: string,
  measurements: RequestMeasurement[],
): PerformanceScenarioSummary {
  const latencyValues = measurements.map(
    (measurement) => measurement.latencyMilliseconds,
  );
  const failures = measurements.filter(
    (measurement) => !measurement.succeeded,
  ).length;
  const statusCodes: Record<string, number> = {};
  for (const measurement of measurements) {
    const statusCode = String(measurement.statusCode);
    statusCodes[statusCode] = (statusCodes[statusCode] ?? 0) + 1;
  }
  return {
    name: scenarioName,
    requests: measurements.length,
    failures,
    errorRate: measurements.length === 0 ? 1 : failures / measurements.length,
    averageLatencyMilliseconds:
      latencyValues.reduce(
        (latencyTotal, latencyValue) => latencyTotal + latencyValue,
        0,
      ) / Math.max(1, latencyValues.length),
    percentile50LatencyMilliseconds: calculatePercentile(latencyValues, 0.5),
    percentile95LatencyMilliseconds: calculatePercentile(latencyValues, 0.95),
    percentile99LatencyMilliseconds: calculatePercentile(latencyValues, 0.99),
    statusCodes,
    routedDeviceCounts: countRoutedDevices(measurements),
  };
}

function buildScenarioSummaries(
  scenarios: PerformanceRequestScenario[],
  measurements: RequestMeasurement[],
): PerformanceScenarioSummary[] {
  return scenarios.map((scenario) =>
    buildScenarioSummary(
      scenario.name,
      measurements.filter(
        (measurement) => measurement.scenarioName === scenario.name,
      ),
    ),
  );
}

function roundMetric(metricValue: number): number {
  return Math.round(metricValue * 100) / 100;
}

function buildThresholdResults(
  errorRate: number,
  percentile95LatencyMilliseconds: number,
  throughputRequestsPerSecond: number,
  routedDeviceCounts: Record<string, number>,
  expectedClientIds: string[],
  configuration: PerformanceConfiguration,
) {
  const missingClientIds = expectedClientIds.filter(
    (clientId) => !routedDeviceCounts[clientId],
  );
  return {
    errorRate: {
      actual: roundMetric(errorRate),
      maximum: configuration.maximumErrorRate,
      passed: errorRate <= configuration.maximumErrorRate,
    },
    percentile95LatencyMilliseconds: {
      actual: roundMetric(percentile95LatencyMilliseconds),
      maximum: configuration.maximum95thPercentileLatencyMilliseconds,
      passed:
        percentile95LatencyMilliseconds <=
        configuration.maximum95thPercentileLatencyMilliseconds,
    },
    throughputRequestsPerSecond: {
      actual: roundMetric(throughputRequestsPerSecond),
      minimum: configuration.minimumThroughputRequestsPerSecond,
      passed:
        throughputRequestsPerSecond >=
        configuration.minimumThroughputRequestsPerSecond,
    },
    routedDeviceCoverage: {
      actual: expectedClientIds.length - missingClientIds.length,
      minimum: expectedClientIds.length,
      missingClientIds,
      passed: missingClientIds.length === 0,
    },
  };
}

function buildThresholdViolations(
  thresholdResults: ReturnType<typeof buildThresholdResults>,
): string[] {
  const thresholdViolations: string[] = [];
  if (!thresholdResults.errorRate.passed) {
    thresholdViolations.push(
      `错误率 ${roundMetric(thresholdResults.errorRate.actual * 100)}% > ${roundMetric(thresholdResults.errorRate.maximum * 100)}%`,
    );
  }
  if (!thresholdResults.percentile95LatencyMilliseconds.passed) {
    thresholdViolations.push(
      `P95 ${thresholdResults.percentile95LatencyMilliseconds.actual}ms > ${thresholdResults.percentile95LatencyMilliseconds.maximum}ms`,
    );
  }
  if (!thresholdResults.throughputRequestsPerSecond.passed) {
    thresholdViolations.push(
      `吞吐 ${thresholdResults.throughputRequestsPerSecond.actual} requests/s < ${thresholdResults.throughputRequestsPerSecond.minimum} requests/s`,
    );
  }
  if (!thresholdResults.routedDeviceCoverage.passed) {
    thresholdViolations.push(
      `未覆盖全部在线设备: ${thresholdResults.routedDeviceCoverage.missingClientIds.join(', ')}`,
    );
  }
  return thresholdViolations;
}

function buildPerformanceReport(
  measuredPhase: MeasuredPerformancePhase,
  scenarios: PerformanceRequestScenario[],
  fixture: PerformanceFixture,
  baseUrl: string,
  configuration: PerformanceConfiguration,
) {
  const allLatencies = measuredPhase.measurements.map(
    (measurement) => measurement.latencyMilliseconds,
  );
  const totalRequests = measuredPhase.measurements.length;
  const failures = measuredPhase.measurements.filter(
    (measurement) => !measurement.succeeded,
  ).length;
  const elapsedSeconds = measuredPhase.elapsedMilliseconds / 1000;
  const errorRate = failures / Math.max(1, totalRequests);
  const throughputRequestsPerSecond = totalRequests / elapsedSeconds;
  const percentile95LatencyMilliseconds = calculatePercentile(
    allLatencies,
    0.95,
  );
  const routedDeviceCounts = countRoutedDevices(measuredPhase.measurements);
  const thresholdResults = buildThresholdResults(
    errorRate,
    percentile95LatencyMilliseconds,
    throughputRequestsPerSecond,
    routedDeviceCounts,
    fixture.devicePool.clientIds,
    configuration,
  );
  const thresholdViolations = buildThresholdViolations(thresholdResults);
  return {
    report: {
      startedAt: new Date(
        Date.now() - measuredPhase.elapsedMilliseconds,
      ).toISOString(),
      completedAt: new Date().toISOString(),
      configuration: {
        baseUrl,
        projectName: configuration.projectName,
        virtualDeviceCount: configuration.virtualDeviceCount,
        durationSeconds: configuration.durationSeconds,
        warmupSeconds: configuration.warmupSeconds,
        concurrency: configuration.concurrency,
        targetRequestsPerSecond: configuration.targetRequestsPerSecond,
      },
      summary: {
        requests: totalRequests,
        failures,
        errorRate: roundMetric(errorRate),
        throughputRequestsPerSecond: roundMetric(throughputRequestsPerSecond),
        percentile50LatencyMilliseconds: roundMetric(
          calculatePercentile(allLatencies, 0.5),
        ),
        percentile95LatencyMilliseconds: roundMetric(
          percentile95LatencyMilliseconds,
        ),
        percentile99LatencyMilliseconds: roundMetric(
          calculatePercentile(allLatencies, 0.99),
        ),
        routedDeviceCounts,
        deviceJobCounts: fixture.devicePool.jobCounts(),
      },
      scenarios: buildScenarioSummaries(
        scenarios,
        measuredPhase.measurements,
      ).map((scenarioSummary) => ({
        ...scenarioSummary,
        errorRate: roundMetric(scenarioSummary.errorRate),
        averageLatencyMilliseconds: roundMetric(
          scenarioSummary.averageLatencyMilliseconds,
        ),
        percentile50LatencyMilliseconds: roundMetric(
          scenarioSummary.percentile50LatencyMilliseconds,
        ),
        percentile95LatencyMilliseconds: roundMetric(
          scenarioSummary.percentile95LatencyMilliseconds,
        ),
        percentile99LatencyMilliseconds: roundMetric(
          scenarioSummary.percentile99LatencyMilliseconds,
        ),
      })),
      thresholds: {
        passed: thresholdViolations.length === 0,
        results: thresholdResults,
        violations: thresholdViolations,
      },
    },
    thresholdViolations,
  };
}

async function runConfiguredPerformanceTest(
  baseUrl: string,
  administratorToken: string,
  fixture: PerformanceFixture,
  configuration: PerformanceConfiguration,
  configurationFile: string,
): Promise<void> {
  const scenarios = buildPerformanceScenarios(
    administratorToken,
    fixture,
    configuration.projectName,
  );
  const commonPhaseInput = {
    baseUrl,
    concurrency: configuration.concurrency,
    targetRequestsPerSecond: configuration.targetRequestsPerSecond,
    requestTimeoutMilliseconds: configuration.requestTimeoutMilliseconds,
    scenarios,
  };
  console.log(
    `已挂载 ${configuration.virtualDeviceCount} 台在线虚拟设备；预热 ${configuration.warmupSeconds}s，随后以 ${configuration.targetRequestsPerSecond} requests/s 运行 ${configuration.durationSeconds}s`,
  );
  if (configuration.warmupSeconds > 0) {
    await runPerformancePhase({
      ...commonPhaseInput,
      durationSeconds: configuration.warmupSeconds,
    });
  }
  const measuredPhase = await runPerformancePhase({
    ...commonPhaseInput,
    durationSeconds: configuration.durationSeconds,
  });
  const { report, thresholdViolations } = buildPerformanceReport(
    measuredPhase,
    scenarios,
    fixture,
    baseUrl,
    configuration,
  );
  await writeAndPrintReport(
    report,
    resolve(dirname(configurationFile), configuration.resultFile),
  );
  if (thresholdViolations.length > 0) {
    throw new Error(`性能阈值未通过:\n- ${thresholdViolations.join('\n- ')}`);
  }
  console.log('性能阈值全部通过');
}

async function writeAndPrintReport(
  report: ReturnType<typeof buildPerformanceReport>['report'],
  resultFile: string,
): Promise<void> {
  await mkdir(dirname(resultFile), { recursive: true });
  await writeFile(resultFile, `${JSON.stringify(report, null, 2)}\n`);
  console.table(
    report.scenarios.map((scenarioSummary) => ({
      场景: scenarioSummary.name,
      请求数: scenarioSummary.requests,
      失败: scenarioSummary.failures,
      平均毫秒: scenarioSummary.averageLatencyMilliseconds,
      P95毫秒: scenarioSummary.percentile95LatencyMilliseconds,
      路由设备数: Object.keys(scenarioSummary.routedDeviceCounts).length,
    })),
  );
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`报告: ${resultFile}`);
}

async function main(): Promise<void> {
  const loadedConfiguration = loadApplicationConfiguration();
  const configuration = loadedConfiguration.configuration;
  const performanceConfiguration = configuration.performance;
  const baseUrl = performanceConfiguration.baseUrl.replace(/\/$/, '');
  const administratorToken = await readAuthenticationToken(
    baseUrl,
    configuration.bootstrap.admin.username,
    configuration.bootstrap.admin.password,
    performanceConfiguration.requestTimeoutMilliseconds,
  );
  const fixture = await preparePerformanceFixture({
    baseUrl,
    administratorToken,
    projectName: performanceConfiguration.projectName,
    virtualDeviceCount: performanceConfiguration.virtualDeviceCount,
    requestTimeoutMilliseconds:
      performanceConfiguration.requestTimeoutMilliseconds,
  });
  try {
    await runConfiguredPerformanceTest(
      baseUrl,
      administratorToken,
      fixture,
      performanceConfiguration,
      loadedConfiguration.configurationFile,
    );
  } finally {
    await fixture.cleanup();
  }
}

void main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
