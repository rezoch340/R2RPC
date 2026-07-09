// 端到端冒烟:登录 -> 建组/设备 -> 手机端登录 -> WS 上线 -> heartbeat -> invoke 闭环 -> 超时/无设备。
// 前置:基础设施 + 迁移 + 种子已就绪,且 API 进程在跑(pnpm dev:api)。用法: pnpm smoke
const WebSocket = require('ws');
const B = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function http(method, path, body, token) {
  const r = await fetch(B + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

let failed = false;
function assert(cond, msg) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + msg);
  if (!cond) failed = true;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await http('POST', '/auth/login', {
        username: 'admin',
        password: 'admin123456',
      });
      if (r.status < 300 && r.json.token) return r.json.token;
    } catch {}
    await sleep(500);
  }
  throw new Error('server not ready');
}

(async () => {
  const admin = await waitReady();
  assert(!!admin, 'admin login');

  // ---------- 设备自注册:admin 建 device token(cn-nodes)-> 设备用它 + 自生成 clientId 连 WS ----------
  const CLIENT_ID = 'smoke-dev-001';
  const regTok = await http(
    'POST',
    '/device-tokens',
    { name: 'reg-token', projects: ['cn-nodes'] },
    admin,
  );
  assert(
    regTok.status < 300 &&
      typeof regTok.json.token === 'string' &&
      regTok.json.token.startsWith('dk_'),
    'admin 建注册用 device token(dk_)',
  );

  const PLATFORM = 'smoke-android';
  const wsUrl = `${B.replace(/^http/, 'ws')}/api/client/ws?token=${encodeURIComponent(regTok.json.token)}&clientId=${CLIENT_ID}&platform=${PLATFORM}&maxInFlight=600`;
  const ws = new WebSocket(wsUrl);
  const got = { welcome: false, heartbeatAck: false };

  const welcomeMsg = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('welcome timeout')), 5000);
    ws.on('error', reject);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'welcome') {
        got.welcome = true;
        clearTimeout(to);
        resolve(m);
      }
    });
  });
  assert(got.welcome, 'received welcome');
  assert(
    Array.isArray(welcomeMsg.projects) && welcomeMsg.projects.length >= 1,
    'welcome 带继承自 device token 的 projects',
  );
  assert(
    typeof welcomeMsg.maxInFlight === 'number' &&
      welcomeMsg.maxInFlight >= 256 &&
      welcomeMsg.maxInFlight <= 1024,
    'welcome 回带 maxInFlight(夹 [256,1024])',
  );

  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'heartbeatAck') got.heartbeatAck = true;
    if (m.type === 'job' && m.action === 'echo') {
      ws.send(
        JSON.stringify({
          type: 'result',
          requestId: m.requestId,
          clientId: CLIENT_ID,
          status: 'ok',
          is_ok: true,
          payload: { echo: m.payload },
        }),
      );
    }
  });

  ws.send(JSON.stringify({ type: 'heartbeat' }));
  await sleep(300);
  assert(got.heartbeatAck, 'received heartbeatAck');

  // #5:服务端应在 ping 间隔内主动 ping 设备(ws 客户端自动回 pong)
  let gotServerPing = false;
  ws.on('ping', () => {
    gotServerPing = true;
  });
  await sleep(6000); // > PING_INTERVAL(5s),至少收到一次
  assert(gotServerPing, '收到服务端主动 ping(#5)');

  // ---------- 阶段3:invoke 改走独立 access token(与用户 JWT/RBAC 完全分离)----------

  // admin 生成一枚只授权 cn-nodes 组的 access token(明文只在创建时回一次)
  const tokenResp = await http(
    'POST',
    '/access-tokens',
    { name: 'smoke-token', projects: ['cn-nodes'] },
    admin,
  );
  assert(
    tokenResp.status < 300 && !!tokenResp.json.token,
    'admin create access token (cn-nodes scoped)',
  );
  const accessToken = tokenResp.json.token;

  // 命中:token 作用域内的组 -> invoke 成功(设备 dev-001 在 cn-nodes)
  const inv = await http(
    'POST',
    '/rpc/invoke/cn-nodes/echo',
    { timeoutSeconds: 10, payload: { encode_str: 'hello' } },
    accessToken,
  );
  assert(
    inv.json.is_ok === true,
    'invoke cn-nodes/echo (作用域内 token) -> is_ok true',
  );
  assert(
    JSON.stringify(inv.json.payload) ===
      JSON.stringify({ echo: { encode_str: 'hello' } }),
    'invoke payload echoed',
  );

  // 越组:设备本身也在 us-nodes,但 token 只开了 cn-nodes -> 403(校验的是 token 的作用域,不是设备的组)
  const inv2 = await http(
    'POST',
    '/rpc/invoke/us-nodes/echo',
    { timeoutSeconds: 10, payload: { encode_str: 'world' } },
    accessToken,
  );
  assert(
    inv2.status === 403,
    'invoke us-nodes/echo with cn-nodes-scoped token -> 403(设备在组,token 不在)',
  );

  // 无效 token(伪造)-> 401
  const invBadToken = await http(
    'POST',
    '/rpc/invoke/cn-nodes/echo',
    { payload: {} },
    'rk_garbage',
  );
  assert(invBadToken.status === 401, 'invoke with invalid token -> 401');

  // 无 Authorization 头 -> 401
  const invNoAuth = await http(
    'POST',
    '/rpc/invoke/cn-nodes/echo',
    { payload: {} },
    null,
  );
  assert(
    invNoAuth.status === 401,
    'invoke without Authorization header -> 401',
  );

  // 撤销:token 撤销后 status != active,再拿它调用 -> 403
  // 先用一次 invoke 预热 guard 的 redis 正缓存(60s TTL),再撤销,证明撤销会同步删缓存,
  // 而不是仅仅数据库层面变了状态(此前 revoke 未清缓存,已用过的 token 撤销后仍可再用满 60s)
  const revokeResp = await http(
    'POST',
    '/access-tokens',
    { name: 'revoke-me', projects: ['cn-nodes'] },
    admin,
  );
  assert(
    revokeResp.status < 300 && !!revokeResp.json.token,
    'admin create revoke-me token',
  );
  const warmInv = await http(
    'POST',
    '/rpc/invoke/cn-nodes/echo',
    { payload: {} },
    revokeResp.json.token,
  );
  assert(
    warmInv.json.is_ok === true,
    'invoke with revoke-me token before revoke -> is_ok true (warms positive cache)',
  );
  const revokeAction = await http(
    'POST',
    `/access-tokens/${revokeResp.json.id}/revoke`,
    null,
    admin,
  );
  assert(revokeAction.status < 300, 'admin revoke revoke-me token');
  const invRevoked = await http(
    'POST',
    '/rpc/invoke/cn-nodes/echo',
    { payload: {} },
    revokeResp.json.token,
  );
  assert(
    invRevoked.status === 403,
    'invoke with revoked token (cache warmed) -> 403 (proves cache invalidated, not just DB)',
  );

  // 超时:有效 cn-nodes token 调一个没人应答的 action
  const t0 = Date.now();
  const inv3 = await http(
    'POST',
    '/rpc/invoke/cn-nodes/sleep',
    { timeoutSeconds: 2, payload: {} },
    accessToken,
  );
  assert(
    inv3.json.is_ok === false && inv3.json.status === 'timeout',
    'invoke unanswered -> timeout',
  );
  console.log('  timeout took ms: ' + (Date.now() - t0));

  const list = await http('GET', '/monitor/requests?pageSize=3', null, admin);
  assert(
    Array.isArray(list.json.rows) &&
      !('requestPayload' in (list.json.rows[0] || {})),
    'monitor list has no payload',
  );

  const m = await http('GET', '/metrics/overview', null, admin);
  assert(
    m.json.totals && typeof m.json.totals.total === 'number',
    'metrics overview',
  );

  const wk = await http('GET', '/metrics/weekly', null, admin);
  assert(
    wk.status === 200 && Array.isArray(wk.json),
    '/metrics/weekly -> 200 数组',
  );
  const tr = await http('GET', '/metrics/trend?days=7', null, admin);
  assert(
    tr.status === 200 && Array.isArray(tr.json) && tr.json.length === 7,
    '/metrics/trend?days=7 -> 7 个按天点(补零)',
  );
  assert(
    tr.json.every(
      (p) =>
        typeof p.statDate === 'string' &&
        typeof p.totalRequests === 'number' &&
        typeof p.successRate === 'number',
    ),
    'trend 每点含 statDate/totalRequests/successRate',
  );

  // ---------- RBAC:operator 角色只读,越权 403,未登录 401 ----------

  // 无 token 访问受保护接口 -> 401
  const noAuth = await http('GET', '/users', null, null);
  assert(noAuth.status === 401, 'unauthenticated GET /users -> 401');

  // 建 op1 用户(409 说明已建过,忽略),挂 operator 角色
  const opCreate = await http(
    'POST',
    '/users',
    { username: 'op1', password: 'oppass123' },
    admin,
  );
  assert(
    opCreate.status < 300 || opCreate.status === 409,
    'create op1 user (or already exists)',
  );

  const rolesList = await http('GET', '/rbac/roles', null, admin);
  const operatorRole = (rolesList.json || []).find(
    (r) => r.name === 'operator',
  );
  assert(!!operatorRole, 'operator role exists (seeded)');

  const usersList = await http('GET', '/users', null, admin);
  const op1 = (usersList.json || []).find((u) => u.username === 'op1');
  assert(!!op1, 'op1 user exists');

  const assignRes = await http(
    'POST',
    `/rbac/users/${op1.id}/roles/${operatorRole.id}`,
    null,
    admin,
  );
  assert(
    assignRes.status < 300 || assignRes.status === 409,
    'assign operator role to op1 (or already assigned)',
  );

  const opLogin = await http('POST', '/auth/login', {
    username: 'op1',
    password: 'oppass123',
  });
  assert(opLogin.status < 300 && !!opLogin.json.token, 'op1 login');
  const opToken = opLogin.json.token;

  const opList = await http('GET', '/users', null, opToken);
  assert(
    opList.status === 200,
    'op1 GET /users -> 200 (operator has read/user)',
  );

  const opCreateDenied = await http(
    'POST',
    '/users',
    { username: 'x2', password: 'xxxxxx' },
    opToken,
  );
  assert(
    opCreateDenied.status === 403,
    'op1 POST /users -> 403 (operator lacks create/user)',
  );

  const opMe = await http('GET', '/auth/me', null, opToken);
  assert(
    opMe.status === 200 && Array.isArray(opMe.json.permissions),
    'op1 GET /auth/me -> 200 with permissions array (operator has read/me)',
  );

  // ---------- Phase 4:软删除 ----------
  // (a) access token 软删(DELETE)与 revoke 正交:删后立即失效,返 401(revoke 是 403)
  const delTok = await http(
    'POST',
    '/access-tokens',
    { name: 'probe-del', projects: ['cn-nodes'] },
    admin,
  );
  assert(delTok.status < 300 && !!delTok.json.token, 'create probe-del token');
  const preDel = await http(
    'POST',
    '/rpc/invoke/cn-nodes/echo',
    { payload: {} },
    delTok.json.token,
  );
  assert(
    preDel.json.is_ok === true,
    'probe-del token works before delete (warms positive cache)',
  );
  const delAction = await http(
    'DELETE',
    `/access-tokens/${delTok.json.id}`,
    null,
    admin,
  );
  assert(delAction.status < 300, 'admin DELETE probe-del token (soft-delete)');
  const postDel = await http(
    'POST',
    '/rpc/invoke/cn-nodes/echo',
    { payload: {} },
    delTok.json.token,
  );
  assert(
    postDel.status === 401,
    'invoke with soft-deleted token -> 401 (distinct from revoke 403; proves alive() filter + cache del)',
  );

  // (b) partial unique:软删后同名可重建(否则旧删除行占用 name -> 409)
  const rn = 'probe-sd-role-' + Date.now();
  const r1 = await http('POST', '/rbac/roles', { name: rn }, admin);
  assert(r1.status < 300 && !!r1.json.id, 'create ' + rn);
  const rDel = await http('DELETE', `/rbac/roles/${r1.json.id}`, null, admin);
  assert(rDel.status < 300, 'soft-delete role');
  const r2 = await http('POST', '/rbac/roles', { name: rn }, admin);
  assert(
    r2.status < 300 && !!r2.json.id && r2.json.id !== r1.json.id,
    'recreate same-name role -> new id (partial unique lets soft-deleted name be reused)',
  );
  await http('DELETE', `/rbac/roles/${r2.json.id}`, null, admin); // 清理:软删掉重建的,免累积

  // ---------- 2b:device token CRUD(admin isRoot 直通 manage/device-token)----------
  const dtCreate = await http(
    'POST',
    '/device-tokens',
    { name: 'dt-smoke', projects: ['cn-nodes'] },
    admin,
  );
  assert(
    dtCreate.status < 300 &&
      typeof dtCreate.json.token === 'string' &&
      dtCreate.json.token.startsWith('dk_'),
    'create device token -> 明文 dk_ token',
  );
  assert(
    Array.isArray(dtCreate.json.projects) &&
      dtCreate.json.projects.includes('cn-nodes'),
    'device token 回显 project cn-nodes',
  );
  const dtList = await http('GET', '/device-tokens', null, admin);
  const dtRow = (dtList.json || []).find((x) => x.id === dtCreate.json.id);
  assert(
    !!dtRow && dtRow.onlineDeviceCount === 0,
    'device token 列表含它且 onlineDeviceCount=0(2c 前无设备继承)',
  );
  const dtRevoke = await http(
    'POST',
    `/device-tokens/${dtCreate.json.id}/revoke`,
    null,
    admin,
  );
  assert(
    dtRevoke.status < 300 && dtRevoke.json.status === 'revoked',
    'revoke device token -> status revoked',
  );
  const dtDel = await http(
    'DELETE',
    `/device-tokens/${dtCreate.json.id}`,
    null,
    admin,
  );
  assert(dtDel.status < 300, 'soft-delete device token');
  const dtList2 = await http('GET', '/device-tokens', null, admin);
  assert(
    !(dtList2.json || []).some((x) => x.id === dtCreate.json.id),
    '软删后 device token 不再出现在列表(alive 过滤)',
  );

  // 设备已在线,注册用 token 的在线设备数应为 1
  const regList = await http('GET', '/device-tokens', null, admin);
  const regRow = (regList.json || []).find((x) => x.id === regTok.json.id);
  assert(
    !!regRow && regRow.onlineDeviceCount === 1,
    '注册 token onlineDeviceCount=1(设备已自注册在线)',
  );

  // 2d:设备持久态(设备已在线,应能在 /devices 查到 online + platform)
  const devList = await http('GET', '/devices', null, admin);
  const devRow = (devList.json || []).find((x) => x.clientId === CLIENT_ID);
  assert(!!devRow, '/devices 列表含自注册设备');
  assert(
    devRow.online === true && devRow.status === 'online',
    '设备 online=true status=online',
  );
  assert(devRow.platform === PLATFORM, '设备 platform 落库(来自 ?platform)');
  assert(
    typeof devRow.lastIp === 'string' && devRow.lastIp.length > 0,
    '设备 last_ip 落库(来自 socket)',
  );
  assert(
    devRow.maxInFlight === 600,
    '设备 maxInFlight 落库(自报 600 在区间内)',
  );
  const devDetail = await http('GET', `/devices/${devRow.id}`, null, admin);
  assert(
    devDetail.status < 300 && devDetail.json.id === devRow.id,
    '/devices/:id 详情',
  );

  // ---------- #8:GroupInfo + 分组启停 ----------
  const gi = await http('GET', '/projects/info', null, admin);
  assert(
    gi.status === 200 && Array.isArray(gi.json),
    '/projects/info -> 200 数组',
  );
  const cn = (gi.json || []).find((x) => x.name === 'cn-nodes');
  assert(
    !!cn &&
      typeof cn.totalDevices === 'number' &&
      typeof cn.onlineDevices === 'number' &&
      typeof cn.status === 'string',
    'GroupInfo cn-nodes 含 totalDevices/onlineDevices/status',
  );
  assert(
    cn.onlineDevices >= 1 && cn.status === 'online',
    'cn-nodes 有在线设备 -> status online',
  );

  // 停用 cn-nodes -> invoke 该组应被拒(disabled),GroupInfo status=disabled
  const projList = await http('GET', '/projects', null, admin);
  const cnProj = (projList.json || []).find((x) => x.name === 'cn-nodes');
  const disable = await http(
    'POST',
    `/projects/${cnProj.id}/enabled`,
    { enabled: false },
    admin,
  );
  assert(
    disable.status < 300 && disable.json.enabled === false,
    '停用 cn-nodes',
  );
  const invDisabled = await http(
    'POST',
    '/rpc/invoke/cn-nodes/echo',
    { payload: {} },
    accessToken,
  );
  assert(
    invDisabled.json.status === 'disabled',
    '停用后 invoke cn-nodes -> disabled 拒派',
  );
  const gi2 = await http('GET', '/projects/info', null, admin);
  const cn2 = (gi2.json || []).find((x) => x.name === 'cn-nodes');
  assert(cn2.status === 'disabled', 'GroupInfo cn-nodes status=disabled');
  // 复原,免影响后续/重跑
  await http(
    'POST',
    `/projects/${cnProj.id}/enabled`,
    { enabled: true },
    admin,
  );

  ws.close();
  await sleep(200);
  console.log(failed ? '\n=== SMOKE FAILED ===' : '\n=== SMOKE PASSED ===');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
