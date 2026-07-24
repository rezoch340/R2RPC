import { PerformanceDevicePool } from './performance-device-pool';

interface CreatedToken {
  id: number;
  token: string;
}

interface ProjectRecord {
  name: string;
  enabled: boolean;
}

interface OnlineDeviceResponse {
  online: string[];
}

export interface PerformanceFixtureInput {
  baseUrl: string;
  administratorToken: string;
  projectName: string;
  virtualDeviceCount: number;
  requestTimeoutMilliseconds: number;
}

export interface PerformanceFixture {
  accessToken: string;
  devicePool: PerformanceDevicePool;
  cleanup: () => Promise<void>;
}

async function requestJson<BodyType>(
  input: PerformanceFixtureInput,
  method: string,
  path: string,
  authenticationToken: string,
  body?: Record<string, unknown>,
): Promise<BodyType> {
  const response = await fetch(`${input.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${authenticationToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(input.requestTimeoutMilliseconds),
  });
  const responseText = await response.text();
  const responseBody: unknown = responseText
    ? JSON.parse(responseText)
    : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${path} 失败: HTTP ${response.status}`);
  }
  return responseBody as BodyType;
}

function assertCreatedToken(
  tokenRecord: CreatedToken,
  prefix: 'rk_' | 'dk_',
): void {
  if (
    !Number.isInteger(tokenRecord.id) ||
    !tokenRecord.token.startsWith(prefix)
  ) {
    throw new Error(`性能测试创建 ${prefix} 令牌失败`);
  }
}

async function deleteToken(
  input: PerformanceFixtureInput,
  path: string,
): Promise<void> {
  try {
    await requestJson(input, 'DELETE', path, input.administratorToken);
  } catch (error) {
    console.error(`性能测试资源清理失败 ${path}: ${(error as Error).message}`);
  }
}

async function assertProjectIsAvailable(
  input: PerformanceFixtureInput,
): Promise<void> {
  const projects = await requestJson<ProjectRecord[]>(
    input,
    'GET',
    '/projects',
    input.administratorToken,
  );
  const project = projects.find(
    (projectRecord) => projectRecord.name === input.projectName,
  );
  if (!project?.enabled) {
    throw new Error(`性能测试功能组不存在或未启用: ${input.projectName}`);
  }
}

export async function preparePerformanceFixture(
  input: PerformanceFixtureInput,
): Promise<PerformanceFixture> {
  await assertProjectIsAvailable(input);
  const resourceIdentifier = `${Date.now().toString(36)}-${process.pid.toString(36)}`;
  const accessToken = await requestJson<CreatedToken>(
    input,
    'POST',
    '/access-tokens',
    input.administratorToken,
    {
      name: `performance-access-${resourceIdentifier}`,
      projects: [input.projectName],
      description: 'Docker 性能测试临时访问令牌',
    },
  );
  assertCreatedToken(accessToken, 'rk_');

  let deviceToken: CreatedToken | undefined;
  let devicePool: PerformanceDevicePool | undefined;
  try {
    deviceToken = await requestJson<CreatedToken>(
      input,
      'POST',
      '/device-tokens',
      input.administratorToken,
      {
        name: `performance-device-${resourceIdentifier}`,
        projects: [input.projectName],
        description: 'Docker 性能测试临时设备令牌',
      },
    );
    assertCreatedToken(deviceToken, 'dk_');
    devicePool = new PerformanceDevicePool({
      baseUrl: input.baseUrl,
      deviceToken: deviceToken.token,
      projectName: input.projectName,
      virtualDeviceCount: input.virtualDeviceCount,
      connectionTimeoutMilliseconds: input.requestTimeoutMilliseconds,
    });
    await devicePool.connect();
    await assertDevicesAreOnline(
      input,
      accessToken.token,
      devicePool.clientIds,
    );
  } catch (error) {
    await devicePool?.close();
    if (deviceToken) {
      await deleteToken(input, `/device-tokens/${deviceToken.id}`);
    }
    await deleteToken(input, `/access-tokens/${accessToken.id}`);
    throw error;
  }

  return {
    accessToken: accessToken.token,
    devicePool,
    cleanup: async () => {
      await devicePool.close();
      await deleteToken(input, `/device-tokens/${deviceToken.id}`);
      await deleteToken(input, `/access-tokens/${accessToken.id}`);
    },
  };
}

async function assertDevicesAreOnline(
  input: PerformanceFixtureInput,
  accessToken: string,
  expectedClientIds: string[],
): Promise<void> {
  const onlineDeviceResponse = await requestJson<OnlineDeviceResponse>(
    input,
    'GET',
    `/rpc/clientQueue?project=${encodeURIComponent(input.projectName)}`,
    accessToken,
  );
  const missingClientIds = expectedClientIds.filter(
    (clientId) => !onlineDeviceResponse.online.includes(clientId),
  );
  if (missingClientIds.length > 0) {
    throw new Error(`虚拟设备未全部上线: ${missingClientIds.join(', ')}`);
  }
}
