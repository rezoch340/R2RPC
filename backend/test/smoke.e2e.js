// R2RPC 黑盒完整性冒烟:
// - 测试进程只使用 HTTP(fetch) 与 WebSocket(ws) 公共接口。
// - 禁止导入应用内部模块或直连 PG/Redis/Manticore。
// - 前置:基础设施、迁移、种子、API 与 Worker 均已启动。
const WebSocket = require('ws');

const BASE_HTTP_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const BASE_WEBSOCKET_URL = BASE_HTTP_URL.replace(/^http/, 'ws');
const TEST_RUN_IDENTIFIER =
  process.env.SMOKE_RUN_ID ||
  `${Date.now().toString(36)}-${process.pid.toString(36)}`;
const TEST_RESOURCE_PREFIX = `e2e-${TEST_RUN_IDENTIFIER}`;

let passed = 0;
let failed = 0;
const cleanup = {
  sockets: new Set(),
  accessTokenIds: [],
  deviceTokenIds: [],
  userIds: [],
  roleIds: [],
  permissionIds: [],
  projectIds: [],
};

function section(name) {
  console.log(`\n--- ${name} ---`);
}

function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${message}`);
    return true;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
  return false;
}

function requireValue(condition, message, value) {
  if (!assert(condition, message)) {
    throw new Error(`前置断言失败: ${message}`);
  }
  return value;
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function httpRequest(method, requestPath, body, token) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_HTTP_URL}${requestPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let responseBody;
  try {
    responseBody = JSON.parse(text);
  } catch {
    responseBody = text;
  }
  return {
    status: response.status,
    headers: response.headers,
    json: responseBody,
    text,
  };
}

async function waitFor(
  description,
  probe,
  timeoutMilliseconds = 10000,
  intervalMilliseconds = 100,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMilliseconds);
  }
  throw new Error(
    `等待超时: ${description}${lastError ? ` (${lastError.message})` : ''}`,
  );
}

async function waitReady() {
  return waitFor(
    'API 与管理员种子就绪',
    async () => {
      const response = await httpRequest('POST', '/auth/login', {
        username: 'admin',
        password: 'admin123456',
      });
      return response.status < 300 && response.json.token
        ? response.json.token
        : null;
    },
    20000,
    250,
  );
}

function deviceWebSocketUrl({ token, clientId, platform, extra, maxInFlight }) {
  const query = new URLSearchParams();
  if (token !== undefined) query.set('token', token);
  if (clientId !== undefined) query.set('clientId', clientId);
  if (platform !== undefined) query.set('platform', platform);
  if (extra !== undefined) query.set('extra', extra);
  if (maxInFlight !== undefined) query.set('maxInFlight', String(maxInFlight));
  return `${BASE_WEBSOCKET_URL}/api/client/ws?${query.toString()}`;
}

function connectDevice(connectionParameters, options = {}) {
  const webSocket = new WebSocket(deviceWebSocketUrl(connectionParameters), {
    autoPong: options.autoPong !== false,
  });
  cleanup.sockets.add(webSocket);

  const messages = [];
  const waiters = [];
  let pingCount = 0;
  let closeResult;
  let resolveClose;
  const closed = new Promise((resolve) => {
    resolveClose = resolve;
  });

  const settleWaiters = (message) => {
    for (
      let waiterIndex = waiters.length - 1;
      waiterIndex >= 0;
      waiterIndex--
    ) {
      const waiter = waiters[waiterIndex];
      if (!waiter.predicate(message)) {
        continue;
      }
      waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  };

  webSocket.on('ping', () => {
    pingCount += 1;
  });
  webSocket.on('message', (messageData) => {
    let message;
    try {
      message = JSON.parse(messageData.toString());
    } catch {
      message = messageData.toString();
    }
    messages.push(message);
    settleWaiters(message);
    if (message?.type === 'job' && client.onJob) {
      void Promise.resolve(client.onJob(message)).catch((error) => {
        console.error(`设备 job handler 失败: ${error.message}`);
      });
    }
  });
  webSocket.on('close', (code, reason) => {
    closeResult = { code, reason: reason.toString() };
    cleanup.sockets.delete(webSocket);
    resolveClose(closeResult);
  });
  webSocket.on('error', () => {
    // 鉴权拒绝、1009 或 terminate 后可能伴随 error，close code 才是断言对象。
  });

  const client = {
    webSocket,
    messages,
    onJob: null,
    get pingCount() {
      return pingCount;
    },
    get closeResult() {
      return closeResult;
    },
    closed,
    send(message) {
      webSocket.send(JSON.stringify(message));
    },
    sendRaw(serializedMessage, sendOptions) {
      webSocket.send(serializedMessage, sendOptions);
    },
    waitMessage(predicate, timeoutMilliseconds = 5000) {
      const existing = messages.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) {
              waiters.splice(index, 1);
            }
            reject(new Error('等待 WebSocket 消息超时'));
          }, timeoutMilliseconds),
        };
        waiters.push(waiter);
      });
    },
  };
  return client;
}

async function closeDevice(client, timeoutMilliseconds = 3000) {
  if (!client || client.closeResult) {
    return client?.closeResult;
  }
  if (
    client.webSocket.readyState === WebSocket.OPEN ||
    client.webSocket.readyState === WebSocket.CONNECTING
  ) {
    client.webSocket.close();
  }
  return Promise.race([
    client.closed,
    sleep(timeoutMilliseconds).then(() => {
      client.webSocket.terminate();
      return { code: null, reason: 'terminate after cleanup timeout' };
    }),
  ]);
}

async function expectWebSocketClose(
  connectionParameters,
  expectedCode,
  message,
  options,
) {
  const client = connectDevice(connectionParameters, options);
  const result = await Promise.race([
    client.closed,
    sleep(7000).then(() => ({ code: null, reason: 'timeout' })),
  ]);
  assert(result.code === expectedCode, `${message} (close=${result.code})`);
  if (!client.closeResult) {
    client.webSocket.terminate();
  }
  return result;
}

async function waitRequestIndexed(administratorAccessToken, requestId) {
  return waitFor(
    `请求日志 ${requestId} 写入并索引`,
    async () => {
      const response = await httpRequest(
        'GET',
        `/monitor/requests/${encodeURIComponent(requestId)}`,
        undefined,
        administratorAccessToken,
      );
      return response.status === 200 && response.json.payloadState === 'indexed'
        ? response.json
        : null;
    },
    15000,
    150,
  );
}

async function bestEffortCleanup(administratorAccessToken) {
  for (const webSocket of [...cleanup.sockets]) {
    try {
      webSocket.terminate();
    } catch {}
  }
  if (!administratorAccessToken) {
    return;
  }

  for (const accessTokenId of cleanup.accessTokenIds.reverse()) {
    await httpRequest(
      'DELETE',
      `/access-tokens/${accessTokenId}`,
      undefined,
      administratorAccessToken,
    ).catch(() => undefined);
  }
  for (const deviceTokenId of cleanup.deviceTokenIds.reverse()) {
    await httpRequest(
      'DELETE',
      `/device-tokens/${deviceTokenId}`,
      undefined,
      administratorAccessToken,
    ).catch(() => undefined);
  }
  for (const userId of cleanup.userIds.reverse()) {
    await httpRequest(
      'DELETE',
      `/users/${userId}`,
      undefined,
      administratorAccessToken,
    ).catch(() => undefined);
  }
  for (const roleId of cleanup.roleIds.reverse()) {
    await httpRequest(
      'DELETE',
      `/rbac/roles/${roleId}`,
      undefined,
      administratorAccessToken,
    ).catch(() => undefined);
  }
  for (const permissionId of cleanup.permissionIds.reverse()) {
    await httpRequest(
      'DELETE',
      `/rbac/permissions/${permissionId}`,
      undefined,
      administratorAccessToken,
    ).catch(() => undefined);
  }
  for (const projectId of cleanup.projectIds.reverse()) {
    await httpRequest(
      'DELETE',
      `/projects/${projectId}`,
      undefined,
      administratorAccessToken,
    ).catch(() => undefined);
  }
}

// 分页与筛选参数的边界与恶意输入。全部只走公开 HTTP 接口。
// 覆盖三类:① 非法分页参数必须 400 而不是 500 或静默夹取;② 筛选值里的 ILIKE 元字符
// 必须按字面量匹配,不能退化成通配;③ 筛选与分页组合时 total 与逐页 rows 必须自洽。
async function assertPaginationBoundaries(administratorAccessToken) {
  const listPath = '/users';
  const readList = (queryString) =>
    httpRequest(
      'GET',
      `${listPath}${queryString}`,
      undefined,
      administratorAccessToken,
    );

  // ① 非法分页参数:DTO 校验应拒绝,而不是让 pageBounds 静默兜底
  const rejectedPaginationCases = [
    ['?page=0', 'page=0'],
    ['?page=-1', 'page=-1'],
    ['?page=abc', 'page 非数字'],
    ['?page=1.5', 'page 非整数'],
    ['?page=1000001', 'page 超过上界(防 OFFSET 溢出 bigint)'],
    ['?pageSize=0', 'pageSize=0'],
    ['?pageSize=101', 'pageSize 超过 100'],
    ['?pageSize=abc', 'pageSize 非数字'],
    ['?page=1&page=2', 'page 传成数组'],
    ['?enabled=bogus', '非法枚举值'],
    ['?username=%00', '查询参数含空字节'],
  ];
  for (const [queryString, description] of rejectedPaginationCases) {
    const response = await readList(queryString);
    assert(response.status === 400, `${description} 返回 400`);
  }

  // ② ILIKE 元字符必须按字面量参与匹配,否则筛选框输入 % 就等于拉全表
  const totalUsers = requireValue(
    (await readList('?pageSize=1')).json?.total,
    '取得用户总数用于对照',
    (await readList('?pageSize=1')).json?.total,
  );
  const wildcardProbes = [
    ['%', '百分号'],
    ['_', '下划线'],
    ['\\', '反斜杠'],
  ];
  for (const [rawValue, description] of wildcardProbes) {
    const response = await readList(
      `?username=${encodeURIComponent(rawValue)}&pageSize=1`,
    );
    assert(
      response.status === 200 && response.json.total < totalUsers,
      `筛选值含${description}时按字面量匹配,不退化成通配(总数 ${response.json?.total} < ${totalUsers})`,
    );
  }
  const longFilterValue = 'a'.repeat(4096);
  const longFilterResponse = await readList(
    `?username=${longFilterValue}&pageSize=1`,
  );
  assert(
    longFilterResponse.status === 200 && longFilterResponse.json.total === 0,
    '超长筛选值正常返回空结果而非 500',
  );

  // ③ 组合行为:筛不到时仍是合法空页;越界页返回空 rows 但 total 不变;逐页累加等于 total
  const emptyFilterResponse = await readList(
    '?username=definitely-no-such-user&page=3&pageSize=10',
  );
  assert(
    emptyFilterResponse.status === 200 &&
      emptyFilterResponse.json.rows.length === 0 &&
      emptyFilterResponse.json.total === 0,
    '筛选无命中时越界页返回 200 空列表而非报错',
  );
  const beyondLastPage = await readList(`?page=${totalUsers + 50}&pageSize=1`);
  assert(
    beyondLastPage.status === 200 &&
      beyondLastPage.json.rows.length === 0 &&
      beyondLastPage.json.total === totalUsers,
    '越过末页时 rows 为空但 total 仍是真实总数',
  );
  let accumulatedRowCount = 0;
  const walkPageSize = 2;
  const totalPages = Math.ceil(totalUsers / walkPageSize);
  for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
    const pageResponse = await readList(
      `?page=${pageNumber}&pageSize=${walkPageSize}`,
    );
    accumulatedRowCount += pageResponse.json.rows.length;
  }
  assert(
    accumulatedRowCount === totalUsers,
    `逐页累加行数等于 total(${accumulatedRowCount} = ${totalUsers})`,
  );
  const boundaryPageSize = await readList('?pageSize=100');
  assert(boundaryPageSize.status === 200, 'pageSize=100 是允许的上界而非越界');
}

// 三个原本返回数组的端点补齐分页,另加两个下拉选项源和仪表盘专用接口。
// 重点验:① 列表信封齐全且真的按页切;② options 不分页、能取全;
// ③ 仪表盘一次拿到全部数字,不必再靠 ?pageSize=1 偷 total。
async function assertNewlyPaginatedEndpoints(administratorAccessToken) {
  const read = (requestPath) =>
    httpRequest('GET', requestPath, undefined, administratorAccessToken);

  const paginatedListPaths = [
    ['/projects/info', '功能组列表'],
    ['/rbac/roles', '权限组列表'],
    ['/rbac/permissions', '权限目录'],
  ];
  for (const [listPath, description] of paginatedListPaths) {
    const firstPage = await read(`${listPath}?page=1&pageSize=1`);
    assert(
      firstPage.status === 200 &&
        Array.isArray(firstPage.json.rows) &&
        firstPage.json.page === 1 &&
        firstPage.json.pageSize === 1 &&
        typeof firstPage.json.total === 'number',
      `${description}返回分页信封`,
    );
    assert(
      firstPage.json.rows.length <= 1 &&
        firstPage.json.total >= firstPage.json.rows.length,
      `${description}按 pageSize 切页且 total 不小于当页行数`,
    );
    const rejected = await read(`${listPath}?pageSize=101`);
    assert(rejected.status === 400, `${description}沿用统一的分页参数校验`);
  }

  // options 是下拉/勾选源,必须能取全,不受 pageSize 限制
  const optionPaths = [
    ['/rbac/roles/options', '权限组下拉'],
    ['/rbac/permissions/options', '权限目录勾选源'],
    ['/projects', '功能组下拉'],
  ];
  for (const [optionPath, description] of optionPaths) {
    const options = await read(optionPath);
    assert(
      options.status === 200 && Array.isArray(options.json),
      `${description}返回全量数组而非分页信封`,
    );
  }
  const permissionOptions = await read('/rbac/permissions/options');
  const pagedPermissions = await read('/rbac/permissions?pageSize=1');
  assert(
    permissionOptions.json.length === pagedPermissions.json.total,
    `权限目录勾选源取到全部 ${pagedPermissions.json.total} 条,不被默认分页截断`,
  );

  // 功能组列表只留基础字段,派生统计单独取
  const projectPage = await read('/projects/info?pageSize=100');
  const sampleProject = projectPage.json.rows[0];
  assert(
    !!sampleProject && !('totalDevices' in sampleProject),
    '功能组列表行不含派生统计字段',
  );
  const stats = await read(`/projects/stats?ids=${sampleProject.id}`);
  assert(
    stats.status === 200 &&
      stats.json[0]?.projectId === sampleProject.id &&
      typeof stats.json[0]?.totalDevices === 'number' &&
      typeof stats.json[0]?.successRate === 'number' &&
      typeof stats.json[0]?.status === 'string',
    '按编号取派生统计返回设备数、成功率与运行态',
  );
  const rejectedStats = await read('/projects/stats?ids=abc');
  assert(rejectedStats.status === 400, '派生统计拒绝非数字编号');
  const emptyStatsIds = await read('/projects/stats?ids=');
  assert(emptyStatsIds.status === 400, '派生统计拒绝空编号列表');

  // 仪表盘一次取全
  const overview = await read('/dashboard/overview');
  assert(
    overview.status === 200 &&
      typeof overview.json.projects?.total === 'number' &&
      typeof overview.json.projects?.enabled === 'number' &&
      typeof overview.json.devices?.total === 'number' &&
      typeof overview.json.devices?.online === 'number' &&
      !!overview.json.requests?.totals &&
      Array.isArray(overview.json.trend),
    '仪表盘概览一次返回功能组计数、设备计数、请求指标与趋势',
  );
  assert(
    overview.json.trend.length === 7,
    `仪表盘趋势固定 7 天(实际 ${overview.json.trend?.length})`,
  );
  const devicePageTotal = (await read('/devices?page=1&pageSize=1')).json.total;
  assert(
    overview.json.devices.total === devicePageTotal,
    `仪表盘设备总数与列表接口一致(${overview.json.devices.total} = ${devicePageTotal})`,
  );
  const projectSummaryTotal = (await read('/projects/summary')).json.total;
  assert(
    overview.json.projects.total === projectSummaryTotal,
    '仪表盘功能组计数与 /projects/summary 一致',
  );
}

// 调用方业务单号:只落日志、可检索,不参与路由与去重(内部 requestId 仍由服务端独占)
async function assertClientRequestId({
  administratorAccessToken,
  callerToken,
  project,
}) {
  const businessOrderNumber = `order-${Date.now()}`;
  const invoked = await httpRequest(
    'POST',
    `/rpc/invoke/${project}/echo`,
    {
      payload: { probe: 'client-request-id' },
      clientRequestId: businessOrderNumber,
    },
    callerToken,
  );
  assert(
    invoked.status < 300 && typeof invoked.json.requestId === 'string',
    `带 clientRequestId 的 invoke 正常返回(status ${invoked.status})`,
  );
  const internalRequestId = invoked.json.requestId;
  assert(
    internalRequestId !== businessOrderNumber,
    '内部 requestId 与调用方单号相互独立,外部值不会顶替内部键',
  );
  await waitRequestIndexed(administratorAccessToken, internalRequestId);

  const filtered = await httpRequest(
    'GET',
    `/monitor/requests?clientRequestId=${encodeURIComponent(businessOrderNumber)}&pageSize=10`,
    undefined,
    administratorAccessToken,
  );
  const matchedRow = filtered.json.rows?.find(
    (row) => row.requestId === internalRequestId,
  );
  assert(
    filtered.status === 200 && !!matchedRow,
    '可按 clientRequestId 精确检索到该次调用',
  );
  assert(
    matchedRow?.clientRequestId === businessOrderNumber,
    '列表回显调用方单号',
  );

  // 不传时应为 null,而不是拿内部 requestId 顶上——否则分不清「调用方打过标签」与「系统补的」
  const withoutOrderNumber = await httpRequest(
    'POST',
    `/rpc/invoke/${project}/echo`,
    { payload: { probe: 'no-client-request-id' } },
    callerToken,
  );
  await waitRequestIndexed(
    administratorAccessToken,
    withoutOrderNumber.json.requestId,
  );
  const plainRow = await httpRequest(
    'GET',
    `/monitor/requests?pageSize=20`,
    undefined,
    administratorAccessToken,
  );
  const untagged = plainRow.json.rows?.find(
    (row) => row.requestId === withoutOrderNumber.json.requestId,
  );
  assert(
    untagged?.clientRequestId === null,
    `未传单号时字段为 null(实际 ${JSON.stringify(untagged?.clientRequestId)})`,
  );

  const missFilter = await httpRequest(
    'GET',
    '/monitor/requests?clientRequestId=definitely-no-such-order&pageSize=10',
    undefined,
    administratorAccessToken,
  );
  assert(
    missFilter.status === 200 && missFilter.json.total === 0,
    '按不存在的单号检索返回空结果',
  );

  const overlongOrderNumber = 'x'.repeat(129);
  const rejected = await httpRequest(
    'POST',
    `/rpc/invoke/${project}/echo`,
    { payload: {}, clientRequestId: overlongOrderNumber },
    callerToken,
  );
  assert(rejected.status === 400, '超过 128 字符的单号被拒绝');
}

async function main() {
  let administratorAccessToken;
  let mainDevice;
  let attackerDevice;
  let silentDevice;

  try {
    section('服务就绪 / Swagger / 登录鉴权');
    administratorAccessToken = await waitReady();
    assert(!!administratorAccessToken, '管理员可通过 HTTP 登录');

    const swagger = await httpRequest('GET', '/docs');
    assert(
      swagger.status === 200 && swagger.text.includes('Swagger UI'),
      'Swagger UI 可通过 HTTP 访问',
    );

    const invalidLoginInputResponse = await httpRequest('POST', '/auth/login', {
      username: 'admin',
      password: '123',
    });
    assert(invalidLoginInputResponse.status === 400, '登录 DTO 校验拒绝短密码');

    const wrongLogin = await httpRequest('POST', '/auth/login', {
      username: 'admin',
      password: 'wrong-password',
    });
    assert(wrongLogin.status === 401, '错误密码返回 401');

    const unauthenticatedProfileResponse = await httpRequest('GET', '/auth/me');
    assert(
      unauthenticatedProfileResponse.status === 401,
      '/auth/me 无 JWT 返回 401',
    );

    const administratorProfile = await httpRequest(
      'GET',
      '/auth/me',
      undefined,
      administratorAccessToken,
    );
    assert(
      administratorProfile.status === 200 &&
        administratorProfile.json.username === 'admin' &&
        administratorProfile.json.isRoot === true,
      '/auth/me 返回 root 管理员身份',
    );

    section('Project CRUD / 启停 / 软删除');
    const projectNames = {
      main: `${TEST_RESOURCE_PREFIX}-main`,
      empty: `${TEST_RESOURCE_PREFIX}-empty`,
      other: `${TEST_RESOURCE_PREFIX}-other`,
      saturation: `${TEST_RESOURCE_PREFIX}-saturation`,
      disposable: `${TEST_RESOURCE_PREFIX}-disposable`,
    };
    const projects = {};
    for (const [key, name] of Object.entries(projectNames)) {
      const response = await httpRequest(
        'POST',
        '/projects',
        {
          name,
          description: key === 'main' ? 'primary black-box project' : undefined,
        },
        administratorAccessToken,
      );
      requireValue(
        response.status < 300 && Number.isInteger(response.json.id),
        `创建 project: ${name}`,
        response,
      );
      projects[key] = response.json;
      cleanup.projectIds.push(response.json.id);
    }

    const duplicateProject = await httpRequest(
      'POST',
      '/projects',
      { name: projectNames.main },
      administratorAccessToken,
    );
    assert(duplicateProject.status === 409, '重复 project 返回 409');

    const projectList = await httpRequest(
      'GET',
      '/projects',
      undefined,
      administratorAccessToken,
    );
    assert(
      projectList.status === 200 &&
        Object.values(projectNames).every((name) =>
          projectList.json.some((row) => row.name === name),
        ) &&
        projectList.json.some(
          (row) =>
            row.name === projectNames.main &&
            row.description === 'primary black-box project',
        ),
      'GET /projects 返回本轮创建的全部 project',
    );

    const emptyInfo = await httpRequest(
      'GET',
      `/projects/info?name=${encodeURIComponent(projectNames.empty)}&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    const emptyInfoRow = emptyInfo.json.rows.find(
      (row) => row.name === projectNames.empty,
    );
    assert(
      emptyInfo.status === 200 &&
        Array.isArray(emptyInfo.json.rows) &&
        typeof emptyInfo.json.total === 'number' &&
        !!emptyInfoRow,
      'GET /projects/info 返回分页信封并支持按名称筛选',
    );
    assert(
      emptyInfoRow !== undefined && !('status' in emptyInfoRow),
      '列表行只含基础字段,派生统计不再混在列表里',
    );
    const emptyStats = await httpRequest(
      'GET',
      `/projects/stats?ids=${emptyInfoRow.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      emptyStats.status === 200 &&
        emptyStats.json[0]?.projectId === emptyInfoRow.id &&
        emptyStats.json[0]?.status === 'no_device',
      '无设备 project 的派生统计状态为 no_device',
    );
    const projectSummary = await httpRequest(
      'GET',
      '/projects/summary',
      undefined,
      administratorAccessToken,
    );
    assert(
      projectSummary.status === 200 &&
        typeof projectSummary.json.total === 'number' &&
        typeof projectSummary.json.enabled === 'number' &&
        projectSummary.json.total >= projectSummary.json.enabled,
      'GET /projects/summary 返回功能组总数与启用数',
    );

    const disableOther = await httpRequest(
      'POST',
      `/projects/${projects.other.id}/enabled`,
      { enabled: false },
      administratorAccessToken,
    );
    assert(
      disableOther.status < 300 && disableOther.json.enabled === false,
      'project 可停用',
    );
    const enableOther = await httpRequest(
      'POST',
      `/projects/${projects.other.id}/enabled`,
      { enabled: true },
      administratorAccessToken,
    );
    assert(
      enableOther.status < 300 && enableOther.json.enabled === true,
      'project 可重新启用',
    );

    const deleteDisposable = await httpRequest(
      'DELETE',
      `/projects/${projects.disposable.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deleteDisposable.status === 200 && deleteDisposable.json.deleted === true,
      'DELETE /projects/:id 执行软删除',
    );
    cleanup.projectIds = cleanup.projectIds.filter(
      (projectId) => projectId !== projects.disposable.id,
    );
    const recreateDisposable = await httpRequest(
      'POST',
      '/projects',
      { name: projectNames.disposable },
      administratorAccessToken,
    );
    assert(
      recreateDisposable.status < 300 &&
        recreateDisposable.json.id !== projects.disposable.id,
      'project 软删后可同名重建且获得新 id',
    );
    cleanup.projectIds.push(recreateDisposable.json.id);

    section('User / RBAC 全接口与实时吊销');
    const username = `${TEST_RESOURCE_PREFIX}-user`;
    let password = 'e2e-pass-123';
    const createUser = await httpRequest(
      'POST',
      '/users',
      {
        username,
        password,
        role: 'operator',
        description: 'black-box account',
      },
      administratorAccessToken,
    );
    requireValue(
      createUser.status < 300 && Number.isInteger(createUser.json.id),
      'POST /users 创建测试用户',
      createUser,
    );
    const userId = createUser.json.id;
    cleanup.userIds.push(userId);

    const userDetail = await httpRequest(
      'GET',
      `/users/${userId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      userDetail.status === 200 &&
        userDetail.json.username === username &&
        userDetail.json.description === 'black-box account' &&
        userDetail.json.isRoot === false,
      'GET /users/:id 返回用户详情且不暴露密码散列',
    );
    assert(!('passwordHash' in userDetail.json), '用户详情不包含 passwordHash');

    const updateUser = await httpRequest(
      'PATCH',
      `/users/${userId}`,
      { description: 'updated through public API' },
      administratorAccessToken,
    );
    assert(
      updateUser.status === 200 &&
        updateUser.json.description === 'updated through public API' &&
        !('passwordHash' in updateUser.json),
      'PATCH /users/:id 修改普通用户资料且不暴露密码散列',
    );

    const changedPassword = 'e2e-pass-changed-123';
    const updateUserPassword = await httpRequest(
      'PATCH',
      `/users/${userId}/password`,
      { password: changedPassword },
      administratorAccessToken,
    );
    assert(
      updateUserPassword.status === 200 &&
        updateUserPassword.json.id === userId &&
        !('passwordHash' in updateUserPassword.json),
      'PATCH /users/:id/password 修改普通用户密码且不暴露密码散列',
    );
    const loginWithPreviousPassword = await httpRequest('POST', '/auth/login', {
      username,
      password,
    });
    assert(loginWithPreviousPassword.status === 401, '改密后旧密码不能再登录');
    password = changedPassword;

    section('系统操作审计日志');
    const administratorUserLogs = await httpRequest(
      'GET',
      '/system-logs?actorUsername=admin&subject=user&pageSize=100',
      undefined,
      administratorAccessToken,
    );
    const createUserSystemLog = administratorUserLogs.json.rows.find(
      (systemLog) =>
        systemLog.name === '创建用户' &&
        systemLog.targetId === String(userId) &&
        systemLog.targetName === username,
    );
    const updatePasswordSystemLog = administratorUserLogs.json.rows.find(
      (systemLog) =>
        systemLog.name === '修改用户密码' &&
        systemLog.targetId === String(userId),
    );
    assert(
      administratorUserLogs.status === 200 &&
        administratorUserLogs.json.total >= 3 &&
        !!createUserSystemLog &&
        createUserSystemLog.description.includes(
          `admin 创建用户 ${username}`,
        ) &&
        !!updatePasswordSystemLog,
      'GET /system-logs 返回谁在何时做了什么',
    );
    assert(
      !JSON.stringify(administratorUserLogs.json).includes(changedPassword),
      '系统操作审计不记录密码',
    );
    const targetedUserLogs = await httpRequest(
      'GET',
      `/system-logs?name=${encodeURIComponent('创建用户')}&targetType=user&targetName=${encodeURIComponent(username)}&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    assert(
      targetedUserLogs.status === 200 &&
        targetedUserLogs.json.rows.some(
          (systemLog) => systemLog.targetId === String(userId),
        ) &&
        targetedUserLogs.json.rows.every(
          (systemLog) =>
            systemLog.name === '创建用户' &&
            systemLog.targetType === 'user' &&
            systemLog.targetName === username,
        ),
      '系统日志支持事件与目标联合筛选',
    );
    const administratorAuthenticationLogs = await httpRequest(
      'GET',
      '/system-logs?actorUsername=admin&action=login&subject=auth&pageSize=100',
      undefined,
      administratorAccessToken,
    );
    assert(
      administratorAuthenticationLogs.status === 200 &&
        administratorAuthenticationLogs.json.rows.some(
          (systemLog) =>
            systemLog.name === '登录系统' &&
            systemLog.status === 'succeeded' &&
            systemLog.actorUserId === administratorProfile.json.id,
        ),
      '系统日志记录登录成功和登录账号',
    );
    const failedAuthenticationLogs = await httpRequest(
      'GET',
      `/system-logs?actorUsername=${encodeURIComponent(username)}&action=login&subject=auth&status=failed&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    assert(
      failedAuthenticationLogs.status === 200 &&
        failedAuthenticationLogs.json.rows.some(
          (systemLog) =>
            systemLog.name === '登录系统' &&
            systemLog.statusCode === 401 &&
            systemLog.actorUserId === 0,
        ) &&
        !JSON.stringify(failedAuthenticationLogs.json).includes(
          changedPassword,
        ),
      '系统日志记录登录失败但不记录密码',
    );
    const administratorReadLogs = await httpRequest(
      'GET',
      '/system-logs?actorUsername=admin&action=read&subject=user&pageSize=100',
      undefined,
      administratorAccessToken,
    );
    assert(
      administratorReadLogs.status === 200 &&
        administratorReadLogs.json.rows.some(
          (systemLog) =>
            systemLog.name === '读取后台账号' &&
            systemLog.targetId === String(userId) &&
            systemLog.status === 'succeeded',
        ),
      '系统日志记录读取了哪个后台账号',
    );

    // 审计要回答「谁按什么条件查了什么」,翻到第几页没有取证价值。
    // 记进去只会让翻十页变成十条只有 page 不同的噪音记录。
    const paginatedSystemLogRead = await httpRequest(
      'GET',
      '/system-logs?actorUsername=admin&page=2&pageSize=5',
      undefined,
      administratorAccessToken,
    );
    assert(paginatedSystemLogRead.status === 200, '带筛选和分页读取系统日志');
    const systemLogReadAudit = await httpRequest(
      'GET',
      '/system-logs?action=read&subject=system-log&pageSize=100',
      undefined,
      administratorAccessToken,
    );
    const systemLogReadRow = systemLogReadAudit.json.rows.find(
      (systemLog) =>
        systemLog.name === '读取系统日志' &&
        systemLog.metadata &&
        systemLog.metadata.actorUsername === 'admin',
    );
    assert(!!systemLogReadRow, '读取系统日志本身仍然留痕并记录筛选条件');
    assert(
      !!systemLogReadRow &&
        !('page' in systemLogReadRow.metadata) &&
        !('pageSize' in systemLogReadRow.metadata),
      '审计 metadata 不记分页参数,翻页不产生只有页码不同的噪音',
    );
    // 只验本次刚产生的那条:历史记录是旧代码写的,metadata 里仍带 page
    await httpRequest(
      'GET',
      `/monitor/requests?project=${encodeURIComponent(projectNames.main)}&page=2&pageSize=5`,
      undefined,
      administratorAccessToken,
    );
    const monitorReadAudit = await httpRequest(
      'GET',
      '/system-logs?action=read&subject=monitor&pageSize=1',
      undefined,
      administratorAccessToken,
    );
    const latestMonitorRead = monitorReadAudit.json.rows[0];
    assert(
      !!latestMonitorRead &&
        latestMonitorRead.metadata.project === projectNames.main &&
        !('page' in latestMonitorRead.metadata) &&
        !('pageSize' in latestMonitorRead.metadata),
      '请求日志读取的审计保留筛选条件但不记分页参数',
    );

    const roleName = `${TEST_RESOURCE_PREFIX}-role`;
    const createRole = await httpRequest(
      'POST',
      '/rbac/roles',
      { name: roleName, description: 'black-box e2e role' },
      administratorAccessToken,
    );
    requireValue(
      createRole.status < 300 && Number.isInteger(createRole.json.id),
      'POST /rbac/roles 创建角色',
      createRole,
    );
    const roleId = createRole.json.id;
    cleanup.roleIds.push(roleId);

    const updateRole = await httpRequest(
      'PATCH',
      `/rbac/roles/${roleId}`,
      { description: 'updated permission group' },
      administratorAccessToken,
    );
    assert(
      updateRole.status === 200 &&
        updateRole.json.description === 'updated permission group' &&
        Array.isArray(updateRole.json.permissions) &&
        updateRole.json.permissions.length === 0,
      'PATCH /rbac/roles/:id 编辑空权限组',
    );

    const customPermission = await httpRequest(
      'POST',
      '/rbac/permissions',
      {
        action: `probe-${TEST_RUN_IDENTIFIER}`,
        subject: `subject-${TEST_RUN_IDENTIFIER}`,
        description: 'black-box e2e permission',
      },
      administratorAccessToken,
    );
    requireValue(
      customPermission.status < 300 &&
        Number.isInteger(customPermission.json.id),
      'POST /rbac/permissions 创建自由权限',
      customPermission,
    );
    const customPermissionId = customPermission.json.id;
    cleanup.permissionIds.push(customPermissionId);

    const permissionsList = await httpRequest(
      'GET',
      '/rbac/permissions?pageSize=100',
      undefined,
      administratorAccessToken,
    );
    const seededPermissionKeys = new Set([
      'read/user',
      'create/user',
      'delete/user',
      'update/user',
      'read/project',
      'create/project',
      'delete/project',
      'update/project',
      'read/metrics',
      'read/monitor',
      'read/system-log',
      'invoke/rpc',
      'read/rpc',
      'read/rbac',
      'manage/rbac',
      'manage/access-token',
      'manage/device-token',
      'read/device',
      'invoke/manual-rpc',
    ]);
    const seededPermissions = permissionsList.json.rows.filter((permission) =>
      seededPermissionKeys.has(`${permission.action}/${permission.subject}`),
    );
    const readUserPermission = permissionsList.json.rows.find(
      (permission) =>
        permission.action === 'read' && permission.subject === 'user',
    );
    const readProjectPermission = permissionsList.json.rows.find(
      (permission) =>
        permission.action === 'read' && permission.subject === 'project',
    );
    const manualRpcPermission = permissionsList.json.rows.find(
      (permission) =>
        permission.action === 'invoke' && permission.subject === 'manual-rpc',
    );
    const delegatedManagementPermissions = [
      permissionsList.json.rows.find(
        (permission) =>
          permission.action === 'update' && permission.subject === 'user',
      ),
      permissionsList.json.rows.find(
        (permission) =>
          permission.action === 'delete' && permission.subject === 'user',
      ),
      permissionsList.json.rows.find(
        (permission) =>
          permission.action === 'manage' && permission.subject === 'rbac',
      ),
      permissionsList.json.rows.find(
        (permission) =>
          permission.action === 'read' && permission.subject === 'rbac',
      ),
      permissionsList.json.rows.find(
        (permission) =>
          permission.action === 'read' && permission.subject === 'system-log',
      ),
    ];
    requireValue(
      permissionsList.status === 200 &&
        !!readUserPermission &&
        !!readProjectPermission &&
        !!manualRpcPermission &&
        delegatedManagementPermissions.every(Boolean),
      'GET /rbac/permissions 含手动 RPC、权限组、系统日志与管理员隔离所需的种子权限',
      readUserPermission,
    );
    assert(
      seededPermissions.length === seededPermissionKeys.size &&
        seededPermissions.every(
          (permission) =>
            typeof permission.description === 'string' &&
            permission.description.trim().length > 0,
        ) &&
        manualRpcPermission.description === '在管理控制台手动发起 RPC 调试调用',
      '全部内置权限都有完整说明，手动 RPC 权限说明准确',
    );

    const attachCustom = await httpRequest(
      'POST',
      `/rbac/roles/${roleId}/permissions`,
      { permissionId: customPermissionId },
      administratorAccessToken,
    );
    assert(
      attachCustom.status < 300 && attachCustom.json.attached === true,
      '角色可绑定自定义权限',
    );
    const detachCustom = await httpRequest(
      'DELETE',
      `/rbac/roles/${roleId}/permissions/${customPermissionId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      detachCustom.status === 200 && detachCustom.json.detached === true,
      '角色可移除自定义权限',
    );

    const attachReadUser = await httpRequest(
      'POST',
      `/rbac/roles/${roleId}/permissions/${readUserPermission.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(attachReadUser.status < 300, '角色绑定 read/user 权限');

    const delegatedPermissionAttachmentResponses = [];
    for (const permission of delegatedManagementPermissions) {
      delegatedPermissionAttachmentResponses.push(
        await httpRequest(
          'POST',
          `/rbac/roles/${roleId}/permissions/${permission.id}`,
          undefined,
          administratorAccessToken,
        ),
      );
    }
    assert(
      delegatedPermissionAttachmentResponses.every(
        (response) => response.status < 300,
      ),
      '权限组绑定系统日志读取及委派管理权限',
    );

    const assignRole = await httpRequest(
      'POST',
      `/rbac/users/${userId}/roles`,
      { roleId },
      administratorAccessToken,
    );
    assert(
      assignRole.status < 300 && assignRole.json.assigned === true,
      '用户可分配角色',
    );

    const userLogin = await httpRequest('POST', '/auth/login', {
      username,
      password,
    });
    requireValue(
      userLogin.status < 300 && !!userLogin.json.token,
      '新用户可登录',
      userLogin,
    );
    let userAuthenticationToken = userLogin.json.token;

    const permittedRead = await httpRequest(
      'GET',
      '/users',
      undefined,
      userAuthenticationToken,
    );
    assert(permittedRead.status === 200, '具有 read/user 的用户可 GET /users');

    // 成功读取系统日志不再留痕,但鉴权失败必须留痕 —— 谁在试探审计日志是重要安全信号。
    // 用一个不挂任何权限组的探针账号,上面那个测试账号此时已被授予 read/system-log。
    const auditProbeUsername = `${TEST_RESOURCE_PREFIX}-audit-probe`;
    const createAuditProbe = await httpRequest(
      'POST',
      '/users',
      {
        username: auditProbeUsername,
        password,
        role: 'operator',
        description: 'black-box audit probe',
      },
      administratorAccessToken,
    );
    requireValue(
      createAuditProbe.status < 300 &&
        Number.isInteger(createAuditProbe.json.id),
      'POST /users 创建审计探针账号',
      createAuditProbe,
    );
    cleanup.userIds.push(createAuditProbe.json.id);
    const auditProbeLogin = await httpRequest('POST', '/auth/login', {
      username: auditProbeUsername,
      password,
    });
    const deniedSystemLogRead = await httpRequest(
      'GET',
      '/system-logs',
      undefined,
      auditProbeLogin.json.token,
    );
    assert(deniedSystemLogRead.status === 403, '无权限账号不能读系统日志');
    const deniedSystemLogAudit = await httpRequest(
      'GET',
      `/system-logs?actorUsername=${encodeURIComponent(auditProbeUsername)}&subject=system-log&status=failed&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deniedSystemLogAudit.status === 200 &&
        deniedSystemLogAudit.json.rows.some(
          (systemLog) =>
            systemLog.subject === 'system-log' &&
            systemLog.status === 'failed' &&
            systemLog.actorUsername === auditProbeUsername,
        ),
      '读取系统日志被拒绝仍然写入系统日志',
    );

    const deniedProjectRead = await httpRequest(
      'GET',
      '/projects',
      undefined,
      userAuthenticationToken,
    );
    assert(
      deniedProjectRead.status === 403,
      '缓存已建立时缺少 read/project 的用户不能 GET /projects',
    );
    const attachReadProject = await httpRequest(
      'POST',
      `/rbac/roles/${roleId}/permissions/${readProjectPermission.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      attachReadProject.status < 300,
      '权限组新增权限后自动删除成员授权缓存',
    );
    const permittedProjectRead = await httpRequest(
      'GET',
      '/projects',
      undefined,
      userAuthenticationToken,
    );
    assert(
      permittedProjectRead.status === 200,
      '权限组新增权限后现有 JWT 立即获得接口权限',
    );
    const detachReadProject = await httpRequest(
      'DELETE',
      `/rbac/roles/${roleId}/permissions/${readProjectPermission.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      detachReadProject.status === 200,
      '权限组移除权限后自动删除成员授权缓存',
    );
    const revokedProjectRead = await httpRequest(
      'GET',
      '/projects',
      undefined,
      userAuthenticationToken,
    );
    assert(
      revokedProjectRead.status === 403,
      '权限组移除权限后现有 JWT 立即失去接口权限',
    );

    const reattachCustomPermission = await httpRequest(
      'POST',
      `/rbac/roles/${roleId}/permissions/${customPermissionId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      reattachCustomPermission.status < 300,
      '已分配权限组可再次绑定自定义权限',
    );
    const profileWithCustomPermission = await httpRequest(
      'GET',
      '/auth/me',
      undefined,
      userAuthenticationToken,
    );
    assert(
      profileWithCustomPermission.status === 200 &&
        profileWithCustomPermission.json.permissions.some(
          (permission) =>
            permission.action === customPermission.json.action &&
            permission.subject === customPermission.json.subject,
        ),
      '自定义权限绑定后现有 JWT 立即获得权限',
    );
    const deleteCustomPermission = await httpRequest(
      'DELETE',
      `/rbac/permissions/${customPermissionId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deleteCustomPermission.status === 200 &&
        deleteCustomPermission.json.deleted === true,
      '删除权限后自动删除所有持有者授权缓存',
    );
    cleanup.permissionIds = cleanup.permissionIds.filter(
      (permissionId) => permissionId !== customPermissionId,
    );
    const profileWithoutCustomPermission = await httpRequest(
      'GET',
      '/auth/me',
      undefined,
      userAuthenticationToken,
    );
    assert(
      profileWithoutCustomPermission.status === 200 &&
        !profileWithoutCustomPermission.json.permissions.some(
          (permission) =>
            permission.action === customPermission.json.action &&
            permission.subject === customPermission.json.subject,
        ),
      '删除权限后现有 JWT 立即失去对应权限',
    );

    const deniedWrite = await httpRequest(
      'POST',
      '/users',
      { username: `${TEST_RESOURCE_PREFIX}-forbidden`, password },
      userAuthenticationToken,
    );
    assert(
      deniedWrite.status === 403,
      '缺少 create/user 的用户不能 POST /users',
    );
    const deniedManualRpcOptions = await httpRequest(
      'GET',
      '/rpc/debug/options',
      undefined,
      userAuthenticationToken,
    );
    assert(
      deniedManualRpcOptions.status === 403,
      '缺少 invoke/manual-rpc 的用户不能读取手动 RPC 调试上下文',
    );
    const deniedAccessLogs = await httpRequest(
      'GET',
      `/system-logs?actorUsername=${encodeURIComponent(username)}&action=execute&subject=user&status=failed&pageSize=100`,
      undefined,
      userAuthenticationToken,
    );
    assert(
      deniedAccessLogs.status === 200 &&
        deniedAccessLogs.json.rows.some(
          (systemLog) =>
            systemLog.name === '执行后台账号' && systemLog.statusCode === 403,
        ),
      '系统日志记录 Guard 拒绝的控制面访问',
    );

    const userMe = await httpRequest(
      'GET',
      '/auth/me',
      undefined,
      userAuthenticationToken,
    );
    assert(
      userMe.status === 200 &&
        userMe.json.permissions.some(
          (permission) =>
            permission.action === 'read' && permission.subject === 'user',
        ),
      '用户 /auth/me 返回实时 RBAC 权限',
    );

    const readablePermissionGroups = await httpRequest(
      'GET',
      '/rbac/roles?pageSize=100',
      undefined,
      userAuthenticationToken,
    );
    const readablePermissionGroup = readablePermissionGroups.json.rows.find(
      (permissionGroup) => permissionGroup.id === roleId,
    );
    assert(
      readablePermissionGroups.status === 200 &&
        !!readablePermissionGroup &&
        readablePermissionGroup.description === 'updated permission group' &&
        readablePermissionGroup.permissions.some(
          (permission) =>
            permission.action === 'read' && permission.subject === 'user',
        ),
      '具有 read/rbac 的用户可读取带嵌套权限的权限组',
    );
    const readablePermissions = await httpRequest(
      'GET',
      '/rbac/permissions?pageSize=100',
      undefined,
      userAuthenticationToken,
    );
    assert(
      readablePermissions.status === 200 &&
        readablePermissions.json.rows.some(
          (permission) =>
            permission.action === 'read' && permission.subject === 'rbac',
        ),
      '具有 read/rbac 的用户可读取权限目录',
    );
    const assignedPermissionGroups = await httpRequest(
      'GET',
      `/rbac/users/${userId}/roles`,
      undefined,
      userAuthenticationToken,
    );
    assert(
      assignedPermissionGroups.status === 200 &&
        assignedPermissionGroups.json.some(
          (permissionGroup) => permissionGroup.id === roleId,
        ),
      'GET /rbac/users/:userId/roles 返回用户已分配权限组',
    );
    const readableSystemLogs = await httpRequest(
      'GET',
      `/system-logs?actorUsername=admin&action=create&subject=user&pageSize=100`,
      undefined,
      userAuthenticationToken,
    );
    assert(
      readableSystemLogs.status === 200 &&
        readableSystemLogs.json.rows.some(
          (systemLog) =>
            systemLog.name === '创建用户' && systemLog.targetName === username,
        ),
      '具有 read/system-log 的普通用户可筛选系统操作日志',
    );
    const forbiddenPermissionGroupCreation = await httpRequest(
      'POST',
      '/rbac/roles',
      {
        name: `${TEST_RESOURCE_PREFIX}-forbidden-group`,
        description: 'must be blocked by RootGuard',
      },
      userAuthenticationToken,
    );
    assert(
      forbiddenPermissionGroupCreation.status === 403,
      '非 root 即使具有 manage/rbac 也不能修改权限组',
    );

    const administratorUserId = administratorProfile.json.id;
    const forbiddenAdministratorProfileUpdate = await httpRequest(
      'PATCH',
      `/users/${administratorUserId}`,
      { description: 'forbidden cross-administrator write' },
      userAuthenticationToken,
    );
    assert(
      forbiddenAdministratorProfileUpdate.status === 403,
      '其他账号不能修改管理员资料',
    );
    const forbiddenAdministratorPasswordUpdate = await httpRequest(
      'PATCH',
      `/users/${administratorUserId}/password`,
      { password: 'forbidden-password-123' },
      userAuthenticationToken,
    );
    assert(
      forbiddenAdministratorPasswordUpdate.status === 403,
      '其他账号不能修改管理员密码',
    );
    const forbiddenAdministratorDisable = await httpRequest(
      'POST',
      `/users/${administratorUserId}/enabled`,
      { enabled: false },
      userAuthenticationToken,
    );
    assert(
      forbiddenAdministratorDisable.status === 403,
      '其他账号不能停用管理员',
    );
    const forbiddenAdministratorDelete = await httpRequest(
      'DELETE',
      `/users/${administratorUserId}`,
      undefined,
      userAuthenticationToken,
    );
    assert(
      forbiddenAdministratorDelete.status === 403,
      '其他账号不能删除管理员',
    );
    const forbiddenAdministratorRoleAssignment = await httpRequest(
      'POST',
      `/rbac/users/${administratorUserId}/roles/${roleId}`,
      undefined,
      userAuthenticationToken,
    );
    assert(
      forbiddenAdministratorRoleAssignment.status === 403,
      '其他账号不能给管理员绑定角色',
    );
    const forbiddenAdministratorRoleRemoval = await httpRequest(
      'DELETE',
      `/rbac/users/${administratorUserId}/roles/${roleId}`,
      undefined,
      userAuthenticationToken,
    );
    assert(
      forbiddenAdministratorRoleRemoval.status === 403,
      '其他账号不能移除管理员角色',
    );

    const unassignRole = await httpRequest(
      'DELETE',
      `/rbac/users/${userId}/roles/${roleId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      unassignRole.status === 200 && unassignRole.json.unassigned === true,
      '用户可移除角色',
    );
    const revokedPermission = await httpRequest(
      'GET',
      '/users',
      undefined,
      userAuthenticationToken,
    );
    assert(
      revokedPermission.status === 403,
      '移除角色后现有 JWT 立即失去接口权限',
    );
    const reassignRole = await httpRequest(
      'POST',
      `/rbac/users/${userId}/roles/${roleId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      reassignRole.status < 300 && reassignRole.json.assigned === true,
      '重新分配权限组后自动删除用户授权缓存',
    );
    const restoredPermission = await httpRequest(
      'GET',
      '/users',
      undefined,
      userAuthenticationToken,
    );
    assert(
      restoredPermission.status === 200,
      '重新分配权限组后现有 JWT 立即恢复接口权限',
    );

    const disableUser = await httpRequest(
      'POST',
      `/users/${userId}/enabled`,
      { enabled: false },
      administratorAccessToken,
    );
    assert(
      disableUser.status < 300 && disableUser.json.enabled === false,
      '用户可停用',
    );
    const disabledUserAuthenticationToken = await httpRequest(
      'GET',
      '/auth/me',
      undefined,
      userAuthenticationToken,
    );
    assert(
      disabledUserAuthenticationToken.status === 403,
      '停用用户的现有 JWT 立即失效',
    );
    const disabledLogin = await httpRequest('POST', '/auth/login', {
      username,
      password,
    });
    assert(disabledLogin.status === 403, '停用用户不能重新登录');

    await httpRequest(
      'POST',
      `/users/${userId}/enabled`,
      { enabled: true },
      administratorAccessToken,
    );
    const reenabledLogin = await httpRequest('POST', '/auth/login', {
      username,
      password,
    });
    requireValue(
      reenabledLogin.status < 300 && !!reenabledLogin.json.token,
      '重新启用后用户可登录',
      reenabledLogin,
    );
    userAuthenticationToken = reenabledLogin.json.token;

    const userList = await httpRequest(
      'GET',
      '/users?pageSize=100',
      undefined,
      administratorAccessToken,
    );
    const userListRow = userList.json.rows.find((row) => row.id === userId);
    assert(
      !!userListRow && typeof userListRow.lastLoginAt === 'string',
      'GET /users 暴露已更新的 lastLoginAt',
    );

    const firstUserPage = await httpRequest(
      'GET',
      '/users?page=1&pageSize=1',
      undefined,
      administratorAccessToken,
    );
    assert(
      firstUserPage.status === 200 &&
        firstUserPage.json.rows.length === 1 &&
        firstUserPage.json.page === 1 &&
        firstUserPage.json.pageSize === 1 &&
        firstUserPage.json.total >= 2,
      'GET /users 返回分页信封并按 pageSize 截断',
    );
    const filteredUserPage = await httpRequest(
      'GET',
      `/users?username=${encodeURIComponent(username)}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      filteredUserPage.json.rows.some((row) => row.id === userId) &&
        filteredUserPage.json.rows.every((row) =>
          row.username.includes(username),
        ) &&
        filteredUserPage.json.total === filteredUserPage.json.rows.length,
      'GET /users 按账号服务端筛选,total 随筛选收敛',
    );
    const disabledUserPage = await httpRequest(
      'GET',
      '/users?enabled=disabled&pageSize=100',
      undefined,
      administratorAccessToken,
    );
    assert(
      disabledUserPage.json.rows.every(
        (userRecord) => userRecord.enabled === false,
      ),
      'GET /users 按启用状态筛选只返回匹配账号',
    );

    const deleteUser = await httpRequest(
      'DELETE',
      `/users/${userId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deleteUser.status === 200 && deleteUser.json.deleted === true,
      'DELETE /users/:id 执行软删除',
    );
    cleanup.userIds = cleanup.userIds.filter(
      (cleanupUserId) => cleanupUserId !== userId,
    );
    const deletedUserAuthenticationToken = await httpRequest(
      'GET',
      '/auth/me',
      undefined,
      userAuthenticationToken,
    );
    assert(
      deletedUserAuthenticationToken.status === 401,
      '软删除用户的现有 JWT 立即失效',
    );

    const detachReadUser = await httpRequest(
      'DELETE',
      `/rbac/roles/${roleId}/permissions/${readUserPermission.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(detachReadUser.status === 200, '角色移除 read/user 权限');

    const deleteRole = await httpRequest(
      'DELETE',
      `/rbac/roles/${roleId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deleteRole.status === 200 && deleteRole.json.deleted === true,
      'DELETE /rbac/roles/:id 执行软删除',
    );
    cleanup.roleIds = cleanup.roleIds.filter(
      (cleanupRoleId) => cleanupRoleId !== roleId,
    );
    const rolesList = await httpRequest(
      'GET',
      '/rbac/roles?pageSize=100',
      undefined,
      administratorAccessToken,
    );
    assert(
      rolesList.status === 200 &&
        !rolesList.json.rows.some((role) => role.id === roleId),
      '软删除角色不再出现在角色列表',
    );

    section('Access token 全生命周期 / 作用域 / 缓存失效');
    const invalidAccessProject = await httpRequest(
      'POST',
      '/access-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-invalid-access`,
        projects: [`${TEST_RESOURCE_PREFIX}-missing`],
      },
      administratorAccessToken,
    );
    assert(
      invalidAccessProject.status === 400,
      'access token 拒绝不存在的 project',
    );

    const createMainAccess = await httpRequest(
      'POST',
      '/access-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-access`,
        projects: [
          projectNames.main,
          projectNames.empty,
          projectNames.saturation,
          projectNames.main,
        ],
        description: 'black-box e2e access token',
      },
      administratorAccessToken,
    );
    requireValue(
      createMainAccess.status < 300 &&
        createMainAccess.json.token?.startsWith('rk_'),
      '创建 rk_ access token',
      createMainAccess,
    );
    const accessToken = createMainAccess.json.token;
    cleanup.accessTokenIds.push(createMainAccess.json.id);
    assert(
      createMainAccess.json.projects.length === 3,
      'access token project 作用域自动去重',
    );

    const accessList = await httpRequest(
      'GET',
      '/access-tokens?pageSize=100',
      undefined,
      administratorAccessToken,
    );
    assert(
      accessList.status === 200 &&
        accessList.json.rows.some(
          (token) =>
            token.id === createMainAccess.json.id &&
            token.projects.includes(projectNames.main),
        ),
      'GET /access-tokens 返回 token 与 project 作用域',
    );
    const accessTokenIdFilteredList = await httpRequest(
      'GET',
      `/access-tokens?id=${createMainAccess.json.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      accessTokenIdFilteredList.status === 200 &&
        accessTokenIdFilteredList.json.rows.length === 1 &&
        accessTokenIdFilteredList.json.rows[0].id === createMainAccess.json.id,
      'GET /access-tokens 支持令牌编号精确筛选',
    );

    const firstAccessTokenPage = await httpRequest(
      'GET',
      '/access-tokens?page=1&pageSize=1',
      undefined,
      administratorAccessToken,
    );
    assert(
      firstAccessTokenPage.json.rows.length === 1 &&
        firstAccessTokenPage.json.pageSize === 1 &&
        firstAccessTokenPage.json.total === accessList.json.total,
      'GET /access-tokens 返回分页信封,total 不随 pageSize 变化',
    );
    // 令牌可以挂多个功能组,EXISTS 子查询若写成 join 会让这类令牌重复出现、total 也被放大
    const accessTokensByProject = await httpRequest(
      'GET',
      `/access-tokens?project=${encodeURIComponent(projectNames.main)}&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    assert(
      accessTokensByProject.json.rows.length > 0 &&
        accessTokensByProject.json.rows.every((token) =>
          token.projects.includes(projectNames.main),
        ) &&
        accessTokensByProject.json.total ===
          accessTokensByProject.json.rows.length,
      'GET /access-tokens 按功能组筛选只返回该作用域令牌且不产生重复行',
    );

    const noInvokeToken = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/echo`,
      { payload: {} },
    );
    assert(noInvokeToken.status === 401, 'invoke 缺 access token 返回 401');
    const invalidInvokeToken = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/echo`,
      { payload: {} },
      'rk_invalid',
    );
    assert(invalidInvokeToken.status === 401, '伪造 access token 返回 401');
    const jwtCannotInvoke = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/echo`,
      { payload: {} },
      administratorAccessToken,
    );
    assert(jwtCannotInvoke.status === 401, '后台 JWT 不能替代 access token');
    const outOfScope = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.other}/echo`,
      { payload: {} },
      accessToken,
    );
    assert(outOfScope.status === 403, 'access token 越 project 作用域返回 403');

    const editableAccessToken = await httpRequest(
      'POST',
      '/access-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-editable-access`,
        projects: [projectNames.main],
      },
      administratorAccessToken,
    );
    cleanup.accessTokenIds.push(editableAccessToken.json.id);
    const warmEditableAccessToken = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.main)}`,
      undefined,
      editableAccessToken.json.token,
    );
    assert(
      warmEditableAccessToken.status === 200,
      '待编辑 access token 正缓存可预热',
    );
    const updateAccessTokenProjects = await httpRequest(
      'PATCH',
      `/access-tokens/${editableAccessToken.json.id}/projects`,
      {
        projects: [projectNames.other, projectNames.empty, projectNames.other],
      },
      administratorAccessToken,
    );
    assert(
      updateAccessTokenProjects.status === 200 &&
        updateAccessTokenProjects.json.projects.length === 2 &&
        updateAccessTokenProjects.json.projects.includes(projectNames.other) &&
        updateAccessTokenProjects.json.projects.includes(projectNames.empty),
      'access token 可二次编辑功能组并自动去重',
    );
    const removedAccessTokenScope = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.main)}`,
      undefined,
      editableAccessToken.json.token,
    );
    assert(
      removedAccessTokenScope.status === 403,
      'access token 删除的功能组作用域立即失效',
    );
    const addedAccessTokenScope = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.other)}`,
      undefined,
      editableAccessToken.json.token,
    );
    assert(
      addedAccessTokenScope.status === 200,
      'access token 新增的功能组作用域立即生效',
    );
    const invalidAccessTokenUpdate = await httpRequest(
      'PATCH',
      `/access-tokens/${editableAccessToken.json.id}/projects`,
      { projects: [`${TEST_RESOURCE_PREFIX}-missing`] },
      administratorAccessToken,
    );
    assert(
      invalidAccessTokenUpdate.status === 400,
      'access token 功能组编辑拒绝不存在的功能组',
    );

    const expiredAccess = await httpRequest(
      'POST',
      '/access-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-expired-access`,
        projects: [projectNames.main],
        expiresAt: '2000-01-01T00:00:00.000Z',
      },
      administratorAccessToken,
    );
    cleanup.accessTokenIds.push(expiredAccess.json.id);
    const expiredInvoke = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/echo`,
      { payload: {} },
      expiredAccess.json.token,
    );
    assert(expiredInvoke.status === 401, '过期 access token 返回 401');

    const usageLimitedAccessToken = await httpRequest(
      'POST',
      '/access-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-usage-limited-access`,
        projects: [projectNames.main],
        maximumUsageCount: 2,
      },
      administratorAccessToken,
    );
    cleanup.accessTokenIds.push(usageLimitedAccessToken.json.id);
    assert(
      usageLimitedAccessToken.status < 300 &&
        usageLimitedAccessToken.json.maximumUsageCount === 2 &&
        usageLimitedAccessToken.json.usageCount === 0,
      'access token 可设置最大 RPC 调用次数',
    );
    const usageLimitedQueueRead = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.main)}`,
      undefined,
      usageLimitedAccessToken.json.token,
    );
    const accessTokensAfterQueueRead = await httpRequest(
      'GET',
      '/access-tokens?pageSize=100',
      undefined,
      administratorAccessToken,
    );
    const usageLimitedAfterQueueRead =
      accessTokensAfterQueueRead.json.rows.find(
        (token) => token.id === usageLimitedAccessToken.json.id,
      );
    assert(
      usageLimitedQueueRead.status === 200 &&
        usageLimitedAfterQueueRead.usageCount === 0,
      '读取在线设备不消耗 access token RPC 调用次数',
    );
    const concurrentUsageLimitedInvocations = await Promise.all([
      httpRequest(
        'POST',
        `/rpc/invoke/${projectNames.main}/usage-limited`,
        { payload: { sequence: 1 } },
        usageLimitedAccessToken.json.token,
      ),
      httpRequest(
        'POST',
        `/rpc/invoke/${projectNames.main}/usage-limited`,
        { payload: { sequence: 2 } },
        usageLimitedAccessToken.json.token,
      ),
      httpRequest(
        'POST',
        `/rpc/invoke/${projectNames.main}/usage-limited`,
        { payload: { sequence: 3 } },
        usageLimitedAccessToken.json.token,
      ),
    ]);
    const acceptedUsageLimitedInvocations =
      concurrentUsageLimitedInvocations.filter(
        (invocationResponse) => invocationResponse.status < 300,
      );
    const rejectedUsageLimitedInvocations =
      concurrentUsageLimitedInvocations.filter(
        (invocationResponse) => invocationResponse.status === 429,
      );
    assert(
      acceptedUsageLimitedInvocations.length === 2 &&
        acceptedUsageLimitedInvocations.every(
          (invocationResponse) =>
            invocationResponse.json.status === 'no_device',
        ),
      '并发 RPC 调用原子消耗次数且无论业务结果均计数',
    );
    assert(
      rejectedUsageLimitedInvocations.length === 1,
      'access token 并发达到最大调用次数后返回 429',
    );
    const expandedUsageLimit = await httpRequest(
      'PATCH',
      `/access-tokens/${usageLimitedAccessToken.json.id}`,
      {
        expiresAt: null,
        maximumUsageCount: 4,
      },
      administratorAccessToken,
    );
    assert(
      expandedUsageLimit.status === 200 &&
        expandedUsageLimit.json.maximumUsageCount === 4 &&
        expandedUsageLimit.json.usageCount === 2 &&
        expandedUsageLimit.json.projects.includes(projectNames.main),
      'access token 可二次编辑时间与次数策略且不重置已用次数',
    );
    const resumedUsageLimitedInvoke = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/usage-limited`,
      { payload: { sequence: 4 } },
      usageLimitedAccessToken.json.token,
    );
    const unlimitedAccessToken = await httpRequest(
      'PATCH',
      `/access-tokens/${usageLimitedAccessToken.json.id}`,
      { maximumUsageCount: null },
      administratorAccessToken,
    );
    assert(
      resumedUsageLimitedInvoke.status < 300 &&
        unlimitedAccessToken.status === 200 &&
        unlimitedAccessToken.json.maximumUsageCount === null &&
        unlimitedAccessToken.json.usageCount === 3,
      'access token 提高上限后恢复调用并可改回不限次数',
    );
    const unlimitedInvocations = await Promise.all([
      httpRequest(
        'POST',
        `/rpc/invoke/${projectNames.main}/usage-unlimited`,
        { payload: { sequence: 5 } },
        usageLimitedAccessToken.json.token,
      ),
      httpRequest(
        'POST',
        `/rpc/invoke/${projectNames.main}/usage-unlimited`,
        { payload: { sequence: 6 } },
        usageLimitedAccessToken.json.token,
      ),
    ]);
    const accessTokensAfterUnlimitedInvocations = await httpRequest(
      'GET',
      '/access-tokens?pageSize=100',
      undefined,
      administratorAccessToken,
    );
    const unlimitedTokenAfterInvocations =
      accessTokensAfterUnlimitedInvocations.json.rows.find(
        (token) => token.id === usageLimitedAccessToken.json.id,
      );
    assert(
      unlimitedInvocations.every((response) => response.status < 300) &&
        unlimitedTokenAfterInvocations.usageCount === 3,
      '不限次数时 RPC 调用不再累计次数',
    );
    const invalidUsageLimit = await httpRequest(
      'PATCH',
      `/access-tokens/${usageLimitedAccessToken.json.id}`,
      { maximumUsageCount: 0 },
      administratorAccessToken,
    );
    assert(
      invalidUsageLimit.status === 400,
      'access token 次数上限拒绝非正整数',
    );

    const revokeAccess = await httpRequest(
      'POST',
      '/access-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-revoke-access`,
        projects: [projectNames.empty],
      },
      administratorAccessToken,
    );
    cleanup.accessTokenIds.push(revokeAccess.json.id);
    const warmAccess = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.empty)}`,
      undefined,
      revokeAccess.json.token,
    );
    assert(warmAccess.status === 200, 'access token 正缓存可预热');
    const revokeAccessAction = await httpRequest(
      'POST',
      `/access-tokens/${revokeAccess.json.id}/revoke`,
      undefined,
      administratorAccessToken,
    );
    assert(
      revokeAccessAction.status < 300 &&
        revokeAccessAction.json.status === 'revoked',
      'access token 可撤销',
    );
    const revokedAccessUse = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.empty)}`,
      undefined,
      revokeAccess.json.token,
    );
    assert(
      revokedAccessUse.status === 403,
      '撤销 access token 后正缓存立即失效',
    );

    const deleteAccess = await httpRequest(
      'POST',
      '/access-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-delete-access`,
        projects: [projectNames.empty],
      },
      administratorAccessToken,
    );
    cleanup.accessTokenIds.push(deleteAccess.json.id);
    await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.empty)}`,
      undefined,
      deleteAccess.json.token,
    );
    const deleteAccessAction = await httpRequest(
      'DELETE',
      `/access-tokens/${deleteAccess.json.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deleteAccessAction.status === 200 &&
        deleteAccessAction.json.deleted === true,
      'access token 可软删除',
    );
    cleanup.accessTokenIds = cleanup.accessTokenIds.filter(
      (accessTokenId) => accessTokenId !== deleteAccess.json.id,
    );
    const deletedAccessUse = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.empty)}`,
      undefined,
      deleteAccess.json.token,
    );
    assert(
      deletedAccessUse.status === 401,
      '软删除 access token 后正缓存立即失效',
    );

    section('Device token 全生命周期 / WS 鉴权');
    const invalidDeviceProject = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-invalid-device`,
        projects: [`${TEST_RESOURCE_PREFIX}-missing`],
      },
      administratorAccessToken,
    );
    assert(
      invalidDeviceProject.status === 400,
      'device token 拒绝不存在的 project',
    );

    const createMainDeviceToken = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-device`,
        projects: [projectNames.main],
        description: 'black-box e2e device token',
      },
      administratorAccessToken,
    );
    requireValue(
      createMainDeviceToken.status < 300 &&
        createMainDeviceToken.json.token?.startsWith('dk_'),
      '创建 dk_ device token',
      createMainDeviceToken,
    );
    const deviceToken = createMainDeviceToken.json.token;
    cleanup.deviceTokenIds.push(createMainDeviceToken.json.id);

    const deviceTokenList = await httpRequest(
      'GET',
      '/device-tokens?pageSize=100',
      undefined,
      administratorAccessToken,
    );
    assert(
      deviceTokenList.status === 200 &&
        deviceTokenList.json.rows.some(
          (token) =>
            token.id === createMainDeviceToken.json.id &&
            token.projects.includes(projectNames.main) &&
            token.onlineDeviceCount === 0,
        ),
      'GET /device-tokens 返回作用域和在线设备数',
    );
    const deviceTokenIdFilteredList = await httpRequest(
      'GET',
      `/device-tokens?id=${createMainDeviceToken.json.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deviceTokenIdFilteredList.status === 200 &&
        deviceTokenIdFilteredList.json.rows.length === 1 &&
        deviceTokenIdFilteredList.json.rows[0].id ===
          createMainDeviceToken.json.id,
      'GET /device-tokens 支持令牌编号精确筛选',
    );

    const firstDeviceTokenPage = await httpRequest(
      'GET',
      '/device-tokens?page=1&pageSize=1',
      undefined,
      administratorAccessToken,
    );
    assert(
      firstDeviceTokenPage.json.rows.length === 1 &&
        firstDeviceTokenPage.json.pageSize === 1 &&
        firstDeviceTokenPage.json.total === deviceTokenList.json.total,
      'GET /device-tokens 返回分页信封,total 不随 pageSize 变化',
    );
    const activeDeviceTokens = await httpRequest(
      'GET',
      '/device-tokens?status=active&pageSize=100',
      undefined,
      administratorAccessToken,
    );
    assert(
      activeDeviceTokens.json.rows.length > 0 &&
        activeDeviceTokens.json.rows.every(
          (token) => token.status === 'active',
        ),
      'GET /device-tokens 按状态服务端筛选只返回匹配令牌',
    );
    const oversizedTokenPageSize = await httpRequest(
      'GET',
      '/device-tokens?pageSize=101',
      undefined,
      administratorAccessToken,
    );
    assert(
      oversizedTokenPageSize.status === 400,
      'GET /device-tokens 的 pageSize 超过 100 返回 400',
    );

    const editableDeviceToken = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-editable-device`,
        projects: [projectNames.main],
      },
      administratorAccessToken,
    );
    cleanup.deviceTokenIds.push(editableDeviceToken.json.id);
    const editableDeviceConnection = connectDevice({
      token: editableDeviceToken.json.token,
      clientId: `${TEST_RESOURCE_PREFIX}-editable-device-before`,
    });
    const originalScopeWelcome = await editableDeviceConnection.waitMessage(
      (message) => message.type === 'welcome',
    );
    assert(
      originalScopeWelcome.projects.length === 1,
      '待编辑 device token 可按原功能组作用域连接',
    );
    const updateDeviceTokenProjects = await httpRequest(
      'PATCH',
      `/device-tokens/${editableDeviceToken.json.id}/projects`,
      {
        projects: [projectNames.other, projectNames.empty, projectNames.other],
      },
      administratorAccessToken,
    );
    assert(
      updateDeviceTokenProjects.status === 200 &&
        updateDeviceTokenProjects.json.projects.length === 2 &&
        updateDeviceTokenProjects.json.projects.includes(projectNames.other) &&
        updateDeviceTokenProjects.json.projects.includes(projectNames.empty),
      'device token 可二次编辑功能组并自动去重',
    );
    const replacedScopeClose = await Promise.race([
      editableDeviceConnection.closed,
      sleep(7000).then(() => ({ code: null, reason: 'timeout' })),
    ]);
    assert(
      replacedScopeClose.code === 4002,
      'device token 功能组更新后主动断开旧作用域连接',
    );
    const updatedDeviceConnection = connectDevice({
      token: editableDeviceToken.json.token,
      clientId: `${TEST_RESOURCE_PREFIX}-editable-device-after`,
    });
    const updatedScopeWelcome = await updatedDeviceConnection.waitMessage(
      (message) => message.type === 'welcome',
    );
    assert(
      updatedScopeWelcome.projects.length === 2,
      'device token 重连后使用更新后的功能组作用域',
    );
    // 在线设备数由一次 GROUP BY 批量装载:同时校验有设备的令牌计到 1、
    // 无设备的令牌仍为 0,批量结果错配到别的令牌时本条即失败。
    const onlineCountList = await httpRequest(
      'GET',
      '/device-tokens?pageSize=100',
      undefined,
      administratorAccessToken,
    );
    const connectedTokenRow = onlineCountList.json.rows.find(
      (token) => token.id === editableDeviceToken.json.id,
    );
    const idleTokenRow = onlineCountList.json.rows.find(
      (token) => token.id === createMainDeviceToken.json.id,
    );
    assert(
      onlineCountList.status === 200 &&
        connectedTokenRow?.onlineDeviceCount === 1 &&
        idleTokenRow?.onlineDeviceCount === 0,
      'GET /device-tokens 的在线设备数按令牌正确归属',
    );
    await closeDevice(updatedDeviceConnection);
    const invalidDeviceTokenUpdate = await httpRequest(
      'PATCH',
      `/device-tokens/${editableDeviceToken.json.id}/projects`,
      { projects: [`${TEST_RESOURCE_PREFIX}-missing`] },
      administratorAccessToken,
    );
    assert(
      invalidDeviceTokenUpdate.status === 400,
      'device token 功能组编辑拒绝不存在的功能组',
    );

    await expectWebSocketClose(
      { clientId: `${TEST_RESOURCE_PREFIX}-missing-token` },
      4001,
      'WS 缺 token 被鉴权拒绝',
    );
    await expectWebSocketClose(
      {
        token: 'dk_invalid',
        clientId: `${TEST_RESOURCE_PREFIX}-invalid-token`,
      },
      4001,
      'WS 伪造 token 被鉴权拒绝',
    );

    const nonExpiringDeviceToken = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-non-expiring-device`,
        projects: [projectNames.main],
        // 兼容旧调用方多传该字段：全局 whitelist 会忽略它，设备令牌仍长期有效。
        expiresAt: '2000-01-01T00:00:00.000Z',
      },
      administratorAccessToken,
    );
    cleanup.deviceTokenIds.push(nonExpiringDeviceToken.json.id);
    const nonExpiringDeviceConnection = connectDevice({
      token: nonExpiringDeviceToken.json.token,
      clientId: `${TEST_RESOURCE_PREFIX}-non-expiring-device`,
    });
    const nonExpiringDeviceWelcome =
      await nonExpiringDeviceConnection.waitMessage(
        (message) => message.type === 'welcome',
      );
    assert(
      nonExpiringDeviceToken.status < 300 &&
        !Object.hasOwn(nonExpiringDeviceToken.json, 'expiresAt') &&
        Array.isArray(nonExpiringDeviceWelcome.projects) &&
        nonExpiringDeviceWelcome.projects.length === 1,
      'device token 无过期字段且仅由撤销或删除控制生命周期',
    );
    await closeDevice(nonExpiringDeviceConnection);

    const revokeDeviceToken = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-revoke-device`,
        projects: [projectNames.main],
      },
      administratorAccessToken,
    );
    cleanup.deviceTokenIds.push(revokeDeviceToken.json.id);
    const warmDevice = connectDevice({
      token: revokeDeviceToken.json.token,
      clientId: `${TEST_RESOURCE_PREFIX}-warm-device`,
    });
    await warmDevice.waitMessage((message) => message.type === 'welcome');
    await closeDevice(warmDevice);
    const revokeDeviceAction = await httpRequest(
      'POST',
      `/device-tokens/${revokeDeviceToken.json.id}/revoke`,
      undefined,
      administratorAccessToken,
    );
    assert(
      revokeDeviceAction.status < 300 &&
        revokeDeviceAction.json.status === 'revoked',
      'device token 可撤销',
    );
    await expectWebSocketClose(
      {
        token: revokeDeviceToken.json.token,
        clientId: `${TEST_RESOURCE_PREFIX}-revoked-device`,
      },
      4001,
      '撤销 device token 后 WS 正缓存立即失效',
    );

    const deleteDeviceToken = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-delete-device`,
        projects: [projectNames.main],
      },
      administratorAccessToken,
    );
    cleanup.deviceTokenIds.push(deleteDeviceToken.json.id);
    const warmDeletedDevice = connectDevice({
      token: deleteDeviceToken.json.token,
      clientId: `${TEST_RESOURCE_PREFIX}-warm-delete-device`,
    });
    await warmDeletedDevice.waitMessage(
      (message) => message.type === 'welcome',
    );
    await closeDevice(warmDeletedDevice);
    const deleteDeviceAction = await httpRequest(
      'DELETE',
      `/device-tokens/${deleteDeviceToken.json.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deleteDeviceAction.status === 200 &&
        deleteDeviceAction.json.deleted === true,
      'device token 可软删除',
    );
    cleanup.deviceTokenIds = cleanup.deviceTokenIds.filter(
      (deviceTokenId) => deviceTokenId !== deleteDeviceToken.json.id,
    );
    await expectWebSocketClose(
      {
        token: deleteDeviceToken.json.token,
        clientId: `${TEST_RESOURCE_PREFIX}-deleted-device`,
      },
      4001,
      '软删除 device token 后 WS 正缓存立即失效',
    );

    section('WebSocket 协议完整性');
    const clientId = `${TEST_RESOURCE_PREFIX}-main-device`;
    const platform = 'e2e-android';
    const extra = JSON.stringify({
      runId: TEST_RUN_IDENTIFIER,
      model: 'virtual',
    });
    mainDevice = connectDevice({
      token: deviceToken,
      clientId,
      platform,
      extra,
      maxInFlight: 8,
    });
    const welcome = await mainDevice.waitMessage(
      (message) => message.type === 'welcome',
    );
    assert(
      welcome.clientId === clientId &&
        Array.isArray(welcome.projects) &&
        welcome.projects.length === 1,
      'WS welcome 返回鉴权 clientId 与继承的 project',
    );
    assert(welcome.maxInFlight === 8, 'WS welcome 尊重设备上报的低并发容量');

    mainDevice.sendRaw('not-json');
    mainDevice.send({ type: 'unknown-message' });
    mainDevice.send({ type: 'heartbeat' });
    const heartbeatAck = await mainDevice.waitMessage(
      (message) => message.type === 'heartbeatAck',
    );
    assert(
      heartbeatAck.type === 'heartbeatAck' &&
        mainDevice.webSocket.readyState === WebSocket.OPEN,
      '非法 JSON/未知消息被忽略且 heartbeat 获得确认',
    );

    mainDevice.send({
      type: 'result',
      requestId: `${TEST_RESOURCE_PREFIX}-not-waiting`,
      clientId,
      status: 'ok',
      is_ok: true,
      payload: {},
    });
    const lateAck = await mainDevice.waitMessage(
      (message) =>
        message.type === 'resultAck' &&
        message.requestId === `${TEST_RESOURCE_PREFIX}-not-waiting`,
    );
    assert(lateAck.outcome === 'late', '无人等待的 WS result 返回 late ack');

    await waitFor('服务端主动 ping', () => mainDevice.pingCount > 0, 7000, 100);
    assert(mainDevice.pingCount > 0, 'WS 服务端主动 ping');

    const queueByProject = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.main)}`,
      undefined,
      accessToken,
    );
    assert(
      queueByProject.status === 200 &&
        queueByProject.json.online.includes(clientId),
      'GET /rpc/clientQueue 按 project 返回在线设备',
    );
    const queueByClient = await httpRequest(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(projectNames.main)}&clientId=${encodeURIComponent(clientId)}`,
      undefined,
      accessToken,
    );
    assert(
      queueByClient.status === 200 && queueByClient.json.online === true,
      'GET /rpc/clientQueue 按 clientId 返回在线状态',
    );

    const deviceList = await httpRequest(
      'GET',
      `/devices?clientId=${encodeURIComponent(clientId)}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      Array.isArray(deviceList.json.rows) &&
        typeof deviceList.json.total === 'number' &&
        deviceList.json.page === 1 &&
        deviceList.json.pageSize === 10,
      'GET /devices 返回分页信封 rows/page/pageSize/total',
    );
    const deviceRow = deviceList.json.rows.find(
      (device) => device.clientId === clientId,
    );
    requireValue(
      !!deviceRow,
      'GET /devices 按 clientId 服务端筛选返回 WS 自注册设备',
      deviceRow,
    );
    assert(
      deviceRow.online === true &&
        deviceRow.status === 'online' &&
        deviceRow.platform === platform &&
        deviceRow.extra === extra &&
        deviceRow.maxInFlight === 8 &&
        typeof deviceRow.lastIp === 'string',
      '设备持久态包含 online/platform/extra/maxInFlight/IP',
    );
    const deviceDetail = await httpRequest(
      'GET',
      `/devices/${deviceRow.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deviceDetail.status === 200 && deviceDetail.json.clientId === clientId,
      'GET /devices/:id 返回设备详情',
    );
    const missingDevice = await httpRequest(
      'GET',
      '/devices/2147483647',
      undefined,
      administratorAccessToken,
    );
    assert(missingDevice.status === 404, '不存在设备详情返回 404');

    const firstDevicePage = await httpRequest(
      'GET',
      '/devices?page=1&pageSize=1',
      undefined,
      administratorAccessToken,
    );
    assert(
      firstDevicePage.json.rows.length === 1 && firstDevicePage.json.total >= 1,
      'GET /devices 按 pageSize 截断返回行,total 仍是全量计数',
    );
    const onlineDevices = await httpRequest(
      'GET',
      '/devices?status=online',
      undefined,
      administratorAccessToken,
    );
    assert(
      onlineDevices.json.rows.length > 0 &&
        onlineDevices.json.rows.every((device) => device.status === 'online'),
      'GET /devices 按 status 服务端筛选只返回匹配设备',
    );
    const overflowDevicePage = await httpRequest(
      'GET',
      '/devices?page=999999&pageSize=10',
      undefined,
      administratorAccessToken,
    );
    assert(
      overflowDevicePage.json.rows.length === 0 &&
        overflowDevicePage.json.total === firstDevicePage.json.total,
      'GET /devices 越界页返回空 rows 但保留 total',
    );
    const oversizedDevicePageSize = await httpRequest(
      'GET',
      '/devices?pageSize=101',
      undefined,
      administratorAccessToken,
    );
    assert(
      oversizedDevicePageSize.status === 400,
      'GET /devices 的 pageSize 超过 100 返回 400',
    );

    // 以下四条守的是「非法输入必须变成 400,而不是打到数据库层炸成 500」
    const overflowingPage = await httpRequest(
      'GET',
      '/devices?page=1000001',
      undefined,
      administratorAccessToken,
    );
    assert(
      overflowingPage.status === 400,
      'page 超过上界返回 400,不让 offset 溢出成 500',
    );
    const nullByteFilter = await httpRequest(
      'GET',
      '/devices?clientId=%00',
      undefined,
      administratorAccessToken,
    );
    assert(
      nullByteFilter.status === 400,
      '筛选值含 NUL 字节返回 400,不打到 PostgreSQL 变 500',
    );
    const oversizedEntityId = await httpRequest(
      'GET',
      '/devices/9999999999',
      undefined,
      administratorAccessToken,
    );
    assert(
      oversizedEntityId.status === 400,
      '实体编号超出 int4 上界返回 400,不查库变 500',
    );
    const invalidMonitorFrom = await httpRequest(
      'GET',
      '/monitor/requests?from=not-a-date',
      undefined,
      administratorAccessToken,
    );
    assert(
      invalidMonitorFrom.status === 400,
      'GET /monitor/requests 非法 from 返回 400,与 /system-logs 口径一致',
    );

    // 同 clientId 新连接覆盖 session；旧连接随后断开不能误清新 session。
    const replacementDevice = connectDevice({
      token: deviceToken,
      clientId,
      platform,
      maxInFlight: 8,
    });
    await replacementDevice.waitMessage(
      (message) => message.type === 'welcome',
    );
    await closeDevice(mainDevice);
    mainDevice = replacementDevice;
    const replacementStillOnline = await waitFor(
      '旧连接断开后新 session 仍在线',
      async () => {
        const response = await httpRequest(
          'GET',
          `/rpc/clientQueue?project=${encodeURIComponent(projectNames.main)}&clientId=${encodeURIComponent(clientId)}`,
          undefined,
          accessToken,
        );
        return response.json.online === true;
      },
      5000,
      100,
    );
    assert(
      replacementStillOnline === true,
      '同 clientId 旧连接断开不会误清新 session',
    );

    const fragmentProbe = connectDevice({
      token: deviceToken,
      clientId: `${TEST_RESOURCE_PREFIX}-fragment-probe`,
    });
    await fragmentProbe.waitMessage((message) => message.type === 'welcome');
    fragmentProbe.sendRaw('{"type":"heartbeat"}', { fin: false });
    const fragmentClose = await fragmentProbe.closed;
    assert(fragmentClose.code === 1009, 'WS 分片数据帧(FIN=0)被 1009 拒绝');

    const oversizedProbe = connectDevice({
      token: deviceToken,
      clientId: `${TEST_RESOURCE_PREFIX}-oversized-probe`,
    });
    await oversizedProbe.waitMessage((message) => message.type === 'welcome');
    oversizedProbe.sendRaw(Buffer.alloc(4 * 1024 * 1024 + 1, 0x61));
    const oversizedClose = await oversizedProbe.closed;
    assert(oversizedClose.code === 1009, 'WS 超过 4 MiB 的单帧被 1009 拒绝');

    const silentDeviceToken = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-silent-device`,
        projects: [projectNames.other],
      },
      administratorAccessToken,
    );
    cleanup.deviceTokenIds.push(silentDeviceToken.json.id);
    silentDevice = connectDevice(
      {
        token: silentDeviceToken.json.token,
        clientId: `${TEST_RESOURCE_PREFIX}-silent-device`,
      },
      { autoPong: false },
    );
    await silentDevice.waitMessage((message) => message.type === 'welcome');
    const silentClosePromise = silentDevice.closed;

    section('RPC 成功 / 失败 / 超时 / 身份匹配 / 日志');
    const normalJobs = [];
    const deviceAudit = {
      schemaVersion: 1,
      title: '设备执行链路',
      metadata: [
        { key: '运行标识', value: TEST_RUN_IDENTIFIER },
        { key: '设备', value: clientId },
      ],
      steps: [
        {
          sequence: 1,
          code: 'lookup-primary',
          name: '查询主上游',
          startedAt: new Date().toISOString(),
          durationMs: 31,
          status: 503,
          request: {
            method: 'POST',
            url: 'https://primary.example.test/lookup',
            headers: { 'content-type': 'application/json' },
            body: { runId: TEST_RUN_IDENTIFIER },
          },
          response: {
            statusCode: 503,
            headers: { 'content-type': 'application/json' },
            bodyFormat: 'json',
            body: { ok: false },
          },
          error: {
            type: 'upstream',
            code: 'UNAVAILABLE',
            message: 'primary unavailable',
          },
        },
        {
          sequence: 2,
          code: 'lookup-fallback',
          name: '查询备用上游',
          startedAt: new Date().toISOString(),
          durationMs: 18,
          status: 200,
          request: {
            method: 'GET',
            url: 'https://fallback.example.test/lookup',
          },
          response: {
            statusCode: 200,
            bodyFormat: 'json',
            body: { ok: true, source: 'fallback' },
          },
        },
      ],
    };
    mainDevice.onJob = async (job) => {
      normalJobs.push(job);
      if (job.action === 'timeout') return;
      if (job.action === 'secure') return;
      if (job.action === 'invalid-audit') {
        mainDevice.send({
          type: 'result',
          requestId: job.requestId,
          clientId,
          status: 'ok',
          is_ok: true,
          payload: { accepted: true },
          appAudit: {
            ...deviceAudit,
            steps: [{ ...deviceAudit.steps[0], sequence: 2 }],
          },
        });
        return;
      }
      if (job.action === 'fail') {
        mainDevice.send({
          type: 'result',
          requestId: job.requestId,
          clientId: 'spoofed-but-ignored',
          status: 'error',
          is_ok: false,
          httpCode: 422,
          error: 'device failure',
          payload: { failed: true },
        });
        return;
      }
      mainDevice.send({
        type: 'result',
        requestId: job.requestId,
        clientId: 'spoofed-but-ignored',
        status: 'ok',
        is_ok: true,
        payload: { echo: job.payload, deadlineAt: job.deadlineAt },
        ...(job.action === 'echo' && job.payload?.text === 'hello'
          ? { appAudit: deviceAudit }
          : {}),
      });
    };

    const manualRpcOptions = await httpRequest(
      'GET',
      `/rpc/debug/options?project=${encodeURIComponent(projectNames.main)}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      manualRpcOptions.status === 200 &&
        manualRpcOptions.json.projects.some(
          (project) => project.name === projectNames.main,
        ) &&
        manualRpcOptions.json.clientIds.includes(clientId),
      '手动 RPC 调试上下文返回功能组与在线设备',
    );
    const manualRpcPayload = {
      source: 'administrator-console',
      sensitiveProbe: `payload-only-${TEST_RUN_IDENTIFIER}`,
    };
    const manualRpcInvoke = await httpRequest(
      'POST',
      `/rpc/debug/invoke/${projectNames.main}/manual-probe?clientId=${encodeURIComponent(clientId)}`,
      { timeoutSeconds: 5, payload: manualRpcPayload },
      administratorAccessToken,
    );
    assert(
      manualRpcInvoke.status === 200 &&
        manualRpcInvoke.json.is_ok === true &&
        manualRpcInvoke.json.clientId === clientId &&
        JSON.stringify(manualRpcInvoke.json.payload.echo) ===
          JSON.stringify(manualRpcPayload),
      '具有 invoke/manual-rpc 的管理员可通过控制面接口完成真实 RPC 调用',
    );
    const refreshedManualRpcOptions = await waitFor(
      '手动 RPC 调试历史 Action 可读',
      async () => {
        const response = await httpRequest(
          'GET',
          `/rpc/debug/options?project=${encodeURIComponent(projectNames.main)}`,
          undefined,
          administratorAccessToken,
        );
        return response.status === 200 &&
          response.json.actions.includes('manual-probe')
          ? response
          : null;
      },
      15000,
      150,
    );
    assert(
      refreshedManualRpcOptions.json.actions.includes('manual-probe'),
      '手动 RPC 调试上下文返回历史 Action',
    );
    const manualRpcAuditLogs = await httpRequest(
      'GET',
      `/system-logs?actorUsername=admin&action=invoke&subject=manual-rpc&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    const manualRpcAuditLog = manualRpcAuditLogs.json.rows.find(
      (systemLog) =>
        systemLog.name === '手动发起 RPC 调试调用' &&
        systemLog.targetId === projectNames.main &&
        systemLog.metadata.action === 'manual-probe',
    );
    assert(
      manualRpcAuditLogs.status === 200 &&
        !!manualRpcAuditLog &&
        manualRpcAuditLog.metadata.clientId === clientId &&
        manualRpcAuditLog.metadata.timeoutSeconds === 5 &&
        !JSON.stringify(manualRpcAuditLog).includes(
          manualRpcPayload.sensitiveProbe,
        ),
      '手动 RPC 调用写入系统审计且不记录 Payload',
    );

    const echoPayload = {
      text: 'hello',
      nested: { runId: TEST_RUN_IDENTIFIER },
    };
    const invokeEcho = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/echo`,
      { timeoutSeconds: 5, payload: echoPayload },
      accessToken,
    );
    assert(
      invokeEcho.status < 300 &&
        invokeEcho.json.is_ok === true &&
        invokeEcho.json.status === 'ok' &&
        invokeEcho.json.clientId === clientId,
      'RPC project 轮询调用成功',
    );
    assert(
      JSON.stringify(invokeEcho.json.payload.echo) ===
        JSON.stringify(echoPayload),
      'RPC payload 经 WS 往返保持一致',
    );
    assert(
      !('appAudit' in invokeEcho.json),
      '设备 appAudit 不透传给同步 invoke 调用方',
    );
    const echoJob = normalJobs.find(
      (job) => job.requestId === invokeEcho.json.requestId,
    );
    assert(
      Number.isFinite(echoJob?.deadlineAt) &&
        echoJob.deadlineAt > Date.now() - 5000,
      '下发 WS job 带 deadlineAt',
    );

    const invokeSpecified = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/echo?clientId=${encodeURIComponent(clientId)}`,
      { payload: { specified: true } },
      accessToken,
    );
    assert(
      invokeSpecified.json.is_ok === true &&
        invokeSpecified.json.clientId === clientId,
      'RPC 可通过 query 指定在线 clientId',
    );

    const invokeFailure = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/fail`,
      { payload: { fail: true } },
      accessToken,
    );
    assert(
      invokeFailure.json.is_ok === false &&
        invokeFailure.json.status === 'error' &&
        invokeFailure.json.httpCode === 422 &&
        invokeFailure.json.error === 'device failure',
      '设备失败结果完整回传 status/httpCode/error',
    );

    const invokeInvalidAudit = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/invalid-audit`,
      { payload: { invalidAudit: true } },
      accessToken,
    );
    assert(
      invokeInvalidAudit.json.is_ok === true &&
        invokeInvalidAudit.json.payload.accepted === true,
      '非法设备 appAudit 被丢弃但不影响 RPC 业务结果',
    );

    const invokeEmpty = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.empty}/echo`,
      { payload: {} },
      accessToken,
    );
    assert(
      invokeEmpty.json.status === 'no_device' &&
        invokeEmpty.json.httpCode === 503,
      '无在线设备 project 返回 no_device',
    );

    const invokeOffline = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/echo?clientId=${encodeURIComponent(`${TEST_RESOURCE_PREFIX}-offline`)}`,
      { payload: {} },
      accessToken,
    );
    assert(
      invokeOffline.json.status === 'offline' &&
        invokeOffline.json.httpCode === 503,
      '指定离线 clientId 返回 offline',
    );

    await httpRequest(
      'POST',
      `/projects/${projects.main.id}/enabled`,
      { enabled: false },
      administratorAccessToken,
    );
    const invokeDisabled = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/echo`,
      { payload: {} },
      accessToken,
    );
    assert(
      invokeDisabled.json.status === 'disabled' &&
        invokeDisabled.json.httpCode === 403,
      '停用 project 后 invoke 返回 disabled',
    );
    const disabledStats = await httpRequest(
      'GET',
      `/projects/stats?ids=${projects.main.id}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      disabledStats.json.find((row) => row.projectId === projects.main.id)
        ?.status === 'disabled',
      '停用 project 的派生统计状态为 disabled',
    );
    await httpRequest(
      'POST',
      `/projects/${projects.main.id}/enabled`,
      { enabled: true },
      administratorAccessToken,
    );

    const timeoutStarted = Date.now();
    const invokeTimeout = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/timeout?clientId=${encodeURIComponent(clientId)}`,
      { timeoutSeconds: 1, payload: { wait: true } },
      accessToken,
    );
    assert(
      invokeTimeout.json.status === 'timeout' &&
        invokeTimeout.json.httpCode === 504 &&
        Date.now() - timeoutStarted >= 900,
      '设备不回 result 时 invoke 按接口超时',
    );

    const attackerId = `${TEST_RESOURCE_PREFIX}-attacker-device`;
    attackerDevice = connectDevice({
      token: deviceToken,
      clientId: attackerId,
      maxInFlight: 300,
    });
    await attackerDevice.waitMessage((message) => message.type === 'welcome');
    const secureInvokePromise = httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.main}/secure?clientId=${encodeURIComponent(clientId)}`,
      { timeoutSeconds: 5, payload: { secure: true } },
      accessToken,
    );
    const secureJob = await mainDevice.waitMessage(
      (message) => message.type === 'job' && message.action === 'secure',
    );
    attackerDevice.send({
      type: 'result',
      requestId: secureJob.requestId,
      clientId,
      status: 'ok',
      is_ok: true,
      payload: { source: 'attacker' },
    });
    const mismatchAck = await attackerDevice.waitMessage(
      (message) =>
        message.type === 'resultAck' &&
        message.requestId === secureJob.requestId,
    );
    assert(
      mismatchAck.outcome === 'mismatch',
      '非目标 WS 设备伪造 result 被身份匹配拒绝',
    );
    mainDevice.send({
      type: 'result',
      requestId: secureJob.requestId,
      clientId: attackerId,
      status: 'ok',
      is_ok: true,
      payload: { source: 'expected-device' },
    });
    const secureInvoke = await secureInvokePromise;
    assert(
      secureInvoke.json.is_ok === true &&
        secureInvoke.json.payload.source === 'expected-device',
      '目标 WS 设备的合法 result 可完成同一请求',
    );
    mainDevice.send({
      type: 'result',
      requestId: secureJob.requestId,
      clientId,
      status: 'ok',
      is_ok: true,
      payload: { duplicate: true },
    });
    const duplicateAck = await mainDevice.waitMessage(
      (message) =>
        message.type === 'resultAck' &&
        message.requestId === secureJob.requestId &&
        message.outcome === 'late',
    );
    assert(duplicateAck.outcome === 'late', '重复 WS result 被去重并返回 late');

    const echoDetail = await waitRequestIndexed(
      administratorAccessToken,
      invokeEcho.json.requestId,
    );
    assert(
      echoDetail.payloadUnavailable === false &&
        JSON.stringify(echoDetail.requestPayload) ===
          JSON.stringify(echoPayload) &&
        JSON.stringify(echoDetail.responsePayload.echo) ===
          JSON.stringify(echoPayload),
      'monitor 详情通过 API 返回 Manticore 请求/响应 payload',
    );
    assert(
      echoDetail.appAudit?.schemaVersion === 1 &&
        echoDetail.appAudit.title === deviceAudit.title &&
        JSON.stringify(echoDetail.appAudit.metadata) ===
          JSON.stringify(deviceAudit.metadata) &&
        echoDetail.appAudit.steps.length === 2 &&
        echoDetail.appAudit.steps[0].error.code === 'UNAVAILABLE' &&
        echoDetail.appAudit.steps[1].response.body.source === 'fallback',
      '设备通过 WS 上报的成功/失败 Step 可由 monitor HTTP API 完整读取',
    );

    const invalidAuditDetail = await waitRequestIndexed(
      administratorAccessToken,
      invokeInvalidAudit.json.requestId,
    );
    assert(
      invalidAuditDetail.appAudit === null,
      '非法 sequence 的设备 appAudit 不进入请求日志',
    );

    section('maxInFlight / 组内跳过饱和设备 / rejected');
    const saturationDeviceToken = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-saturation-device`,
        projects: [projectNames.saturation],
      },
      administratorAccessToken,
    );
    cleanup.deviceTokenIds.push(saturationDeviceToken.json.id);
    const saturationAId = `${TEST_RESOURCE_PREFIX}-sat-a`;
    const saturationBId = `${TEST_RESOURCE_PREFIX}-sat-b`;
    const saturationA = connectDevice({
      token: saturationDeviceToken.json.token,
      clientId: saturationAId,
      maxInFlight: 4,
    });
    const saturationB = connectDevice({
      token: saturationDeviceToken.json.token,
      clientId: saturationBId,
      maxInFlight: 4,
    });
    await Promise.all([
      saturationA.waitMessage((message) => message.type === 'welcome'),
      saturationB.waitMessage((message) => message.type === 'welcome'),
    ]);

    const heldJobs = [];
    let releaseMode = false;
    saturationA.onJob = (job) => {
      heldJobs.push(job);
      if (!releaseMode) return;
      saturationA.send({
        type: 'result',
        requestId: job.requestId,
        clientId: saturationAId,
        status: 'ok',
        is_ok: true,
        payload: { released: true },
      });
    };
    saturationB.onJob = (job) => {
      saturationB.send({
        type: 'result',
        requestId: job.requestId,
        clientId: saturationBId,
        status: 'ok',
        is_ok: true,
        payload: { selected: saturationBId },
      });
    };

    const heldInvokes = Array.from({ length: 4 }, (unusedValue, index) =>
      httpRequest(
        'POST',
        `/rpc/invoke/${projectNames.saturation}/hold?clientId=${encodeURIComponent(saturationAId)}`,
        { timeoutSeconds: 8, payload: { index } },
        accessToken,
      ),
    );
    await waitFor(
      '4 个 HTTP invoke 全部通过 WS 下发到低并发饱和探针',
      () => heldJobs.length === 4,
      10000,
      25,
    );
    assert(heldJobs.length === 4, '仅通过 HTTP+WS 占满设备上报的 4 个在途槽');

    const skipSaturated = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.saturation}/probe`,
      { timeoutSeconds: 3, payload: {} },
      accessToken,
    );
    assert(
      skipSaturated.json.is_ok === true &&
        skipSaturated.json.clientId === saturationBId,
      '组轮询跳过已满设备并选择未满设备',
    );

    await closeDevice(saturationB);
    await waitFor(
      '第二台设备从 clientQueue 下线',
      async () => {
        const response = await httpRequest(
          'GET',
          `/rpc/clientQueue?project=${encodeURIComponent(projectNames.saturation)}`,
          undefined,
          accessToken,
        );
        return !response.json.online.includes(saturationBId);
      },
      5000,
      100,
    );

    const groupRejected = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.saturation}/hold`,
      { timeoutSeconds: 2, payload: {} },
      accessToken,
    );
    assert(
      groupRejected.json.status === 'rejected' &&
        groupRejected.json.httpCode === 429,
      'project 内所有在线设备饱和时返回 rejected/429',
    );
    const clientRejected = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.saturation}/hold?clientId=${encodeURIComponent(saturationAId)}`,
      { timeoutSeconds: 2, payload: {} },
      accessToken,
    );
    assert(
      clientRejected.json.status === 'rejected' &&
        clientRejected.json.httpCode === 429,
      '指定饱和设备时返回 rejected/429',
    );

    const heldResults = await Promise.all(heldInvokes);
    assert(
      heldResults.length === 4 &&
        heldResults.every(
          (response) =>
            response.json.status === 'timeout' &&
            response.json.httpCode === 504,
        ),
      '占槽请求均通过 HTTP timeout 返回并释放槽',
    );

    releaseMode = true;
    const afterRelease = await httpRequest(
      'POST',
      `/rpc/invoke/${projectNames.saturation}/probe?clientId=${encodeURIComponent(saturationAId)}`,
      { timeoutSeconds: 3, payload: {} },
      accessToken,
    );
    assert(
      afterRelease.json.is_ok === true &&
        afterRelease.json.payload.released === true,
      '超时后在途槽已释放，设备可继续接收 RPC',
    );
    await closeDevice(saturationA);

    section('Monitor / 筛选 / 分页 / payload / Metrics');
    const requestList = await waitFor(
      '本轮日志经 Worker 出现在 monitor',
      async () => {
        const response = await httpRequest(
          'GET',
          `/monitor/requests?project=${encodeURIComponent(projectNames.main)}&pageSize=100`,
          undefined,
          administratorAccessToken,
        );
        return response.status === 200 &&
          response.json.rows.some(
            (row) => row.requestId === invokeEcho.json.requestId,
          )
          ? response
          : null;
      },
      15000,
      150,
    );
    assert(
      requestList.json.page === 1 &&
        requestList.json.pageSize === 100 &&
        requestList.json.total >= 8,
      'monitor 请求列表支持 project 过滤与分页',
    );
    assert(
      requestList.json.rows.every(
        (row) =>
          !('requestPayload' in row) &&
          !('responsePayload' in row) &&
          !('appAudit' in row),
      ),
      'monitor 列表只返回 PG 脊柱，不返回 payload/appAudit',
    );
    assert(
      requestList.json.rows.every((row) => 'accessTokenId' in row) &&
        requestList.json.rows.some(
          (row) => typeof row.accessTokenId === 'number',
        ),
      'monitor 列表返回 OpenAPI 声明的 accessTokenId 调用方身份',
    );
    const accessTokenFilteredRequests = await httpRequest(
      'GET',
      `/monitor/requests?project=${encodeURIComponent(projectNames.main)}&accessTokenId=${createMainAccess.json.id}&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    assert(
      accessTokenFilteredRequests.status === 200 &&
        accessTokenFilteredRequests.json.rows.some(
          (row) => row.requestId === invokeEcho.json.requestId,
        ) &&
        accessTokenFilteredRequests.json.rows.every(
          (row) => row.accessTokenId === createMainAccess.json.id,
        ),
      'monitor 支持 Access Token 编号精确筛选',
    );
    assert(
      requestList.json.rows.some(
        (row) =>
          row.requestId === manualRpcInvoke.json.requestId &&
          row.requesterUserId === administratorProfile.json.id,
      ),
      '手动 RPC 请求日志记录发起后台账号',
    );

    const statusFiltered = await httpRequest(
      'GET',
      `/monitor/requests?project=${encodeURIComponent(projectNames.main)}&status=ok&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    assert(
      statusFiltered.status === 200 &&
        statusFiltered.json.rows.length > 0 &&
        statusFiltered.json.rows.every((row) => row.status === 'ok'),
      'monitor 支持 status 过滤',
    );
    const payloadAndLatencyFiltered = await httpRequest(
      'GET',
      `/monitor/requests?project=${encodeURIComponent(projectNames.main)}&payloadState=indexed&minimumLatencyMs=0&maximumLatencyMs=60000&pageSize=100`,
      undefined,
      administratorAccessToken,
    );
    assert(
      payloadAndLatencyFiltered.status === 200 &&
        payloadAndLatencyFiltered.json.rows.length > 0 &&
        payloadAndLatencyFiltered.json.rows.every(
          (row) =>
            row.payloadState === 'indexed' &&
            row.latencyMs >= 0 &&
            row.latencyMs <= 60000,
        ),
      'monitor 支持载荷索引状态与耗时范围过滤',
    );
    const actionFiltered = await httpRequest(
      'GET',
      `/monitor/requests?project=${encodeURIComponent(projectNames.main)}&action=echo&clientId=${encodeURIComponent(clientId)}&from=${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60000).toISOString())}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      actionFiltered.status === 200 &&
        actionFiltered.json.rows.some(
          (row) => row.requestId === invokeEcho.json.requestId,
        ) &&
        actionFiltered.json.rows.every(
          (row) =>
            row.actionName === 'echo' &&
            row.clientId === clientId &&
            row.projectName === projectNames.main,
        ),
      'monitor 支持 action/clientId/from/to 联合过滤',
    );

    const requestOptions = await httpRequest(
      'GET',
      `/monitor/request-options?project=${encodeURIComponent(projectNames.main)}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      requestOptions.status === 200 &&
        requestOptions.json.actions.includes('echo') &&
        requestOptions.json.clientIds.includes(clientId),
      'monitor request-options 返回去重 action/clientId',
    );
    const linkedOptions = await httpRequest(
      'GET',
      `/monitor/request-options?action=${encodeURIComponent(`${TEST_RESOURCE_PREFIX}-missing-action`)}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      linkedOptions.status === 200 && linkedOptions.json.projects.length === 0,
      'monitor request-options 执行联动过滤',
    );

    const missingLogDetail = await httpRequest(
      'GET',
      `/monitor/requests/${TEST_RESOURCE_PREFIX}-missing-request`,
      undefined,
      administratorAccessToken,
    );
    assert(missingLogDetail.status === 404, '不存在请求日志详情返回 404');

    const overview = await httpRequest(
      'GET',
      '/metrics/overview',
      undefined,
      administratorAccessToken,
    );
    assert(
      overview.status === 200 &&
        overview.json.totals.total >= 8 &&
        overview.json.byStatus.some((row) => row.status === 'ok'),
      'metrics overview 返回总量与状态分布',
    );

    const weekly = await waitFor(
      '本轮设备指标聚合可读',
      async () => {
        const response = await httpRequest(
          'GET',
          `/metrics/weekly?project=${encodeURIComponent(projectNames.main)}`,
          undefined,
          administratorAccessToken,
        );
        return response.status === 200 &&
          response.json.some(
            (row) => row.clientId === clientId && row.totalRequests > 0,
          )
          ? response
          : null;
      },
      15000,
      150,
    );
    assert(
      weekly.json.every((row) => row.project === projectNames.main),
      'metrics weekly 只返回指定 project',
    );

    const trend = await httpRequest(
      'GET',
      `/metrics/trend?days=7&project=${encodeURIComponent(projectNames.main)}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      trend.status === 200 &&
        trend.json.length === 7 &&
        trend.json.every(
          (point) =>
            typeof point.statDate === 'string' &&
            typeof point.totalRequests === 'number' &&
            typeof point.successRate === 'number',
        ) &&
        trend.json.some((point) => point.totalRequests > 0),
      'metrics trend 按天补零并包含本轮聚合',
    );
    const invalidTrend = await httpRequest(
      'GET',
      '/metrics/trend?days=91',
      undefined,
      administratorAccessToken,
    );
    assert(invalidTrend.status === 400, 'metrics trend 拒绝 days > 90');

    const finalGroupInfo = await httpRequest(
      'GET',
      `/projects/stats?ids=${projects.main.id}`,
      undefined,
      administratorAccessToken,
    );
    const mainGroupInfo = finalGroupInfo.json.find(
      (row) => row.projectId === projects.main.id,
    );
    assert(
      mainGroupInfo.totalDevices >= 2 &&
        mainGroupInfo.onlineDevices >= 2 &&
        mainGroupInfo.requests7d > 0 &&
        mainGroupInfo.status === 'online',
      'GroupInfo 汇总设备、在线数、近 7 天请求与运行态',
    );

    const silentClose = await Promise.race([
      silentClosePromise,
      sleep(32000).then(() => ({ code: null, reason: 'timeout' })),
    ]);
    assert(
      silentClose.code === 1006,
      '不回 pong/不发消息的 WS 在读超时后被服务端 terminate',
    );

    await closeDevice(attackerDevice);
    await closeDevice(mainDevice);
    const mainOffline = await waitFor(
      '主设备优雅断开后持久态离线',
      async () => {
        const response = await httpRequest(
          'GET',
          '/devices',
          undefined,
          administratorAccessToken,
        );
        const row = response.json.rows.find(
          (device) => device.clientId === clientId,
        );
        return row?.online === false && row?.status === 'offline';
      },
      5000,
      100,
    );
    assert(mainOffline === true, 'WS 优雅断开后设备持久态变为 offline');

    section('分页与筛选参数边界');
    await assertPaginationBoundaries(administratorAccessToken);

    section('补齐分页的端点与仪表盘接口');
    await assertNewlyPaginatedEndpoints(administratorAccessToken);

    section('调用方业务单号 clientRequestId');
    await assertClientRequestId({
      administratorAccessToken,
      callerToken: accessToken,
      project: projectNames.main,
    });
  } finally {
    await bestEffortCleanup(administratorAccessToken);
  }
}

main()
  .then(() => {
    console.log(
      `\n=== BLACK-BOX SMOKE ${failed ? 'FAILED' : 'PASSED'}: ${passed} passed, ${failed} failed ===`,
    );
    process.exit(failed ? 1 : 0);
  })
  .catch((error) => {
    console.error(`\nERROR: ${error.stack || error.message}`);
    void bestEffortCleanup()
      .catch(() => undefined)
      .finally(() => process.exit(1));
  });
