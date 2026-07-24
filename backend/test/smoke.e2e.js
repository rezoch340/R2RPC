// RER0RPC 黑盒完整性冒烟:
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
        { name },
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
        ),
      'GET /projects 返回本轮创建的全部 project',
    );

    const emptyInfo = await httpRequest(
      'GET',
      '/projects/info',
      undefined,
      administratorAccessToken,
    );
    const emptyInfoRow = emptyInfo.json.find(
      (row) => row.name === projectNames.empty,
    );
    assert(
      emptyInfo.status === 200 && emptyInfoRow?.status === 'no_device',
      '无设备 project 的 GroupInfo 状态为 no_device',
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
    const password = 'e2e-pass-123';
    const createUser = await httpRequest(
      'POST',
      '/users',
      { username, password, role: 'operator' },
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
      userDetail.status === 200 && userDetail.json.username === username,
      'GET /users/:id 返回用户详情且不暴露密码散列',
    );
    assert(!('passwordHash' in userDetail.json), '用户详情不包含 passwordHash');

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
      '/rbac/permissions',
      undefined,
      administratorAccessToken,
    );
    const readUserPermission = permissionsList.json.find(
      (permission) =>
        permission.action === 'read' && permission.subject === 'user',
    );
    requireValue(
      permissionsList.status === 200 && !!readUserPermission,
      'GET /rbac/permissions 含种子 read/user',
      readUserPermission,
    );

    const attachCustom = await httpRequest(
      'POST',
      `/rbac/roles/${roleId}/permissions/${customPermissionId}`,
      undefined,
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

    const assignRole = await httpRequest(
      'POST',
      `/rbac/users/${userId}/roles/${roleId}`,
      undefined,
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
    await httpRequest(
      'POST',
      `/rbac/users/${userId}/roles/${roleId}`,
      undefined,
      administratorAccessToken,
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
      '/users',
      undefined,
      administratorAccessToken,
    );
    const userListRow = userList.json.find((row) => row.id === userId);
    assert(
      !!userListRow && typeof userListRow.lastLoginAt === 'string',
      'GET /users 暴露已更新的 lastLoginAt',
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

    const deleteCustomPermission = await httpRequest(
      'DELETE',
      `/rbac/permissions/${customPermissionId}`,
      undefined,
      administratorAccessToken,
    );
    assert(
      deleteCustomPermission.status === 200 &&
        deleteCustomPermission.json.deleted === true,
      'DELETE /rbac/permissions/:id 执行软删除',
    );
    cleanup.permissionIds = cleanup.permissionIds.filter(
      (permissionId) => permissionId !== customPermissionId,
    );

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
      '/rbac/roles',
      undefined,
      administratorAccessToken,
    );
    assert(
      rolesList.status === 200 &&
        !rolesList.json.some((role) => role.id === roleId),
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
      '/access-tokens',
      undefined,
      administratorAccessToken,
    );
    assert(
      accessList.status === 200 &&
        accessList.json.some(
          (token) =>
            token.id === createMainAccess.json.id &&
            token.projects.includes(projectNames.main),
        ),
      'GET /access-tokens 返回 token 与 project 作用域',
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
      '/device-tokens',
      undefined,
      administratorAccessToken,
    );
    assert(
      deviceTokenList.status === 200 &&
        deviceTokenList.json.some(
          (token) =>
            token.id === createMainDeviceToken.json.id &&
            token.projects.includes(projectNames.main) &&
            token.onlineDeviceCount === 0,
        ),
      'GET /device-tokens 返回作用域和在线设备数',
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

    const expiredDeviceToken = await httpRequest(
      'POST',
      '/device-tokens',
      {
        name: `${TEST_RESOURCE_PREFIX}-expired-device`,
        projects: [projectNames.main],
        expiresAt: '2000-01-01T00:00:00.000Z',
      },
      administratorAccessToken,
    );
    cleanup.deviceTokenIds.push(expiredDeviceToken.json.id);
    await expectWebSocketClose(
      {
        token: expiredDeviceToken.json.token,
        clientId: `${TEST_RESOURCE_PREFIX}-expired-device`,
      },
      4001,
      '过期 device token 被 WS 鉴权拒绝',
    );

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
      maxInFlight: 600,
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
    assert(welcome.maxInFlight === 600, 'WS welcome 返回夹取后的 maxInFlight');

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
      '/devices',
      undefined,
      administratorAccessToken,
    );
    const deviceRow = deviceList.json.find(
      (device) => device.clientId === clientId,
    );
    requireValue(!!deviceRow, 'GET /devices 返回 WS 自注册设备', deviceRow);
    assert(
      deviceRow.online === true &&
        deviceRow.status === 'online' &&
        deviceRow.platform === platform &&
        deviceRow.extra === extra &&
        deviceRow.maxInFlight === 600 &&
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

    // 同 clientId 新连接覆盖 session；旧连接随后断开不能误清新 session。
    const replacementDevice = connectDevice({
      token: deviceToken,
      clientId,
      platform,
      maxInFlight: 600,
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
    const disabledInfo = await httpRequest(
      'GET',
      '/projects/info',
      undefined,
      administratorAccessToken,
    );
    assert(
      disabledInfo.json.find((row) => row.id === projects.main.id)?.status ===
        'disabled',
      '停用 project 的 GroupInfo 状态为 disabled',
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
      maxInFlight: 256,
    });
    const saturationB = connectDevice({
      token: saturationDeviceToken.json.token,
      clientId: saturationBId,
      maxInFlight: 256,
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

    const heldInvokes = Array.from({ length: 256 }, (unusedValue, index) =>
      httpRequest(
        'POST',
        `/rpc/invoke/${projectNames.saturation}/hold?clientId=${encodeURIComponent(saturationAId)}`,
        { timeoutSeconds: 8, payload: { index } },
        accessToken,
      ),
    );
    await waitFor(
      '256 个 HTTP invoke 全部通过 WS 下发到饱和探针',
      () => heldJobs.length === 256,
      10000,
      25,
    );
    assert(heldJobs.length === 256, '仅通过 HTTP+WS 占满设备 256 个在途槽');

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
      heldResults.length === 256 &&
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
          `/monitor/requests?project=${encodeURIComponent(projectNames.main)}&pageSize=200`,
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
        requestList.json.pageSize === 200 &&
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

    const statusFiltered = await httpRequest(
      'GET',
      `/monitor/requests?project=${encodeURIComponent(projectNames.main)}&status=ok&pageSize=200`,
      undefined,
      administratorAccessToken,
    );
    assert(
      statusFiltered.status === 200 &&
        statusFiltered.json.rows.length > 0 &&
        statusFiltered.json.rows.every((row) => row.status === 'ok'),
      'monitor 支持 status 过滤',
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
      '/projects/info',
      undefined,
      administratorAccessToken,
    );
    const mainGroupInfo = finalGroupInfo.json.find(
      (row) => row.id === projects.main.id,
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
        const row = response.json.find(
          (device) => device.clientId === clientId,
        );
        return row?.online === false && row?.status === 'offline';
      },
      5000,
      100,
    );
    assert(mainOffline === true, 'WS 优雅断开后设备持久态变为 offline');
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
