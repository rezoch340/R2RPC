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
  try { json = JSON.parse(text); } catch { json = text; }
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
      const r = await http('POST', '/auth/login', { username: 'admin', password: 'admin123456' });
      if (r.status < 300 && r.json.token) return r.json.token;
    } catch {}
    await sleep(500);
  }
  throw new Error('server not ready');
}

(async () => {
  const admin = await waitReady();
  assert(!!admin, 'admin login');

  // 建组 + 建设备账号(多组:cn-nodes + us-nodes),409 说明种子已建过,忽略即可(幂等)
  const created = await http(
    'POST', '/clients',
    { clientId: 'dev-001', secret: 'secret123', groups: ['cn-nodes', 'us-nodes'] },
    admin,
  );
  assert(created.status < 300 || created.status === 409, 'create device account (or already exists)');

  const cl = await http('POST', '/api/client/login', { clientId: 'dev-001', secret: 'secret123' });
  assert(cl.status < 300 && !!cl.json.wsUrl, 'client login returns wsUrl');
  const loginGroups = cl.json.groups || [];
  assert(
    loginGroups.includes('cn-nodes') && loginGroups.includes('us-nodes'),
    'client login groups include cn-nodes + us-nodes',
  );

  const ws = new WebSocket(cl.json.wsUrl);
  const got = { welcome: false, heartbeatAck: false };

  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('welcome timeout')), 5000);
    ws.on('error', reject);
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'welcome') { got.welcome = true; clearTimeout(to); resolve(); }
    });
  });
  assert(got.welcome, 'received welcome');

  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'heartbeatAck') got.heartbeatAck = true;
    if (m.type === 'job' && m.action === 'echo') {
      ws.send(JSON.stringify({
        type: 'result', requestId: m.requestId, clientId: 'dev-001',
        status: 'ok', is_ok: true, payload: { echo: m.payload },
      }));
    }
  });

  ws.send(JSON.stringify({ type: 'heartbeat' }));
  await sleep(300);
  assert(got.heartbeatAck, 'received heartbeatAck');

  // ---------- 阶段3:invoke 改走独立 access token(与用户 JWT/RBAC 完全分离)----------

  // admin 生成一枚只授权 cn-nodes 组的 access token(明文只在创建时回一次)
  const tokenResp = await http('POST', '/access-tokens', { name: 'smoke-token', groups: ['cn-nodes'] }, admin);
  assert(tokenResp.status < 300 && !!tokenResp.json.token, 'admin create access token (cn-nodes scoped)');
  const accessToken = tokenResp.json.token;

  // 命中:token 作用域内的组 -> invoke 成功(设备 dev-001 在 cn-nodes)
  const inv = await http('POST', '/rpc/invoke/cn-nodes/echo', { timeoutSeconds: 10, payload: { encode_str: 'hello' } }, accessToken);
  assert(inv.json.is_ok === true, 'invoke cn-nodes/echo (作用域内 token) -> is_ok true');
  assert(JSON.stringify(inv.json.payload) === JSON.stringify({ echo: { encode_str: 'hello' } }), 'invoke payload echoed');

  // 越组:设备本身也在 us-nodes,但 token 只开了 cn-nodes -> 403(校验的是 token 的作用域,不是设备的组)
  const inv2 = await http('POST', '/rpc/invoke/us-nodes/echo', { timeoutSeconds: 10, payload: { encode_str: 'world' } }, accessToken);
  assert(inv2.status === 403, 'invoke us-nodes/echo with cn-nodes-scoped token -> 403(设备在组,token 不在)');

  // 无效 token(伪造)-> 401
  const invBadToken = await http('POST', '/rpc/invoke/cn-nodes/echo', { payload: {} }, 'rk_garbage');
  assert(invBadToken.status === 401, 'invoke with invalid token -> 401');

  // 无 Authorization 头 -> 401
  const invNoAuth = await http('POST', '/rpc/invoke/cn-nodes/echo', { payload: {} }, null);
  assert(invNoAuth.status === 401, 'invoke without Authorization header -> 401');

  // 撤销:token 撤销后 status != active,再拿它调用 -> 403
  // 先用一次 invoke 预热 guard 的 redis 正缓存(60s TTL),再撤销,证明撤销会同步删缓存,
  // 而不是仅仅数据库层面变了状态(此前 revoke 未清缓存,已用过的 token 撤销后仍可再用满 60s)
  const revokeResp = await http('POST', '/access-tokens', { name: 'revoke-me', groups: ['cn-nodes'] }, admin);
  assert(revokeResp.status < 300 && !!revokeResp.json.token, 'admin create revoke-me token');
  const warmInv = await http('POST', '/rpc/invoke/cn-nodes/echo', { payload: {} }, revokeResp.json.token);
  assert(warmInv.json.is_ok === true, 'invoke with revoke-me token before revoke -> is_ok true (warms positive cache)');
  const revokeAction = await http('POST', `/access-tokens/${revokeResp.json.id}/revoke`, null, admin);
  assert(revokeAction.status < 300, 'admin revoke revoke-me token');
  const invRevoked = await http('POST', '/rpc/invoke/cn-nodes/echo', { payload: {} }, revokeResp.json.token);
  assert(invRevoked.status === 403, 'invoke with revoked token (cache warmed) -> 403 (proves cache invalidated, not just DB)');

  // 超时:有效 cn-nodes token 调一个没人应答的 action
  const t0 = Date.now();
  const inv3 = await http('POST', '/rpc/invoke/cn-nodes/sleep', { timeoutSeconds: 2, payload: {} }, accessToken);
  assert(inv3.json.is_ok === false && inv3.json.status === 'timeout', 'invoke unanswered -> timeout');
  console.log('  timeout took ms: ' + (Date.now() - t0));

  const list = await http('GET', '/monitor/requests?pageSize=3', null, admin);
  assert(Array.isArray(list.json.rows) && !('requestPayload' in (list.json.rows[0] || {})), 'monitor list has no payload');

  const m = await http('GET', '/metrics/overview', null, admin);
  assert(m.json.totals && typeof m.json.totals.total === 'number', 'metrics overview');

  // ---------- RBAC:operator 角色只读,越权 403,未登录 401 ----------

  // 无 token 访问受保护接口 -> 401
  const noAuth = await http('GET', '/users', null, null);
  assert(noAuth.status === 401, 'unauthenticated GET /users -> 401');

  // 建 op1 用户(409 说明已建过,忽略),挂 operator 角色
  const opCreate = await http('POST', '/users', { username: 'op1', password: 'oppass123' }, admin);
  assert(opCreate.status < 300 || opCreate.status === 409, 'create op1 user (or already exists)');

  const rolesList = await http('GET', '/rbac/roles', null, admin);
  const operatorRole = (rolesList.json || []).find((r) => r.name === 'operator');
  assert(!!operatorRole, 'operator role exists (seeded)');

  const usersList = await http('GET', '/users', null, admin);
  const op1 = (usersList.json || []).find((u) => u.username === 'op1');
  assert(!!op1, 'op1 user exists');

  const assignRes = await http('POST', `/rbac/users/${op1.id}/roles/${operatorRole.id}`, null, admin);
  assert(assignRes.status < 300 || assignRes.status === 409, 'assign operator role to op1 (or already assigned)');

  const opLogin = await http('POST', '/auth/login', { username: 'op1', password: 'oppass123' });
  assert(opLogin.status < 300 && !!opLogin.json.token, 'op1 login');
  const opToken = opLogin.json.token;

  const opList = await http('GET', '/users', null, opToken);
  assert(opList.status === 200, 'op1 GET /users -> 200 (operator has read/user)');

  const opCreateDenied = await http('POST', '/users', { username: 'x2', password: 'xxxxxx' }, opToken);
  assert(opCreateDenied.status === 403, 'op1 POST /users -> 403 (operator lacks create/user)');

  const opMe = await http('GET', '/auth/me', null, opToken);
  assert(
    opMe.status === 200 && Array.isArray(opMe.json.permissions),
    'op1 GET /auth/me -> 200 with permissions array (operator has read/me)',
  );

  // ---------- Phase 4:软删除 ----------
  // (a) access token 软删(DELETE)与 revoke 正交:删后立即失效,返 401(revoke 是 403)
  const delTok = await http('POST', '/access-tokens', { name: 'probe-del', groups: ['cn-nodes'] }, admin);
  assert(delTok.status < 300 && !!delTok.json.token, 'create probe-del token');
  const preDel = await http('POST', '/rpc/invoke/cn-nodes/echo', { payload: {} }, delTok.json.token);
  assert(preDel.json.is_ok === true, 'probe-del token works before delete (warms positive cache)');
  const delAction = await http('DELETE', `/access-tokens/${delTok.json.id}`, null, admin);
  assert(delAction.status < 300, 'admin DELETE probe-del token (soft-delete)');
  const postDel = await http('POST', '/rpc/invoke/cn-nodes/echo', { payload: {} }, delTok.json.token);
  assert(postDel.status === 401, 'invoke with soft-deleted token -> 401 (distinct from revoke 403; proves alive() filter + cache del)');

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

  ws.close();
  await sleep(200);
  console.log(failed ? '\n=== SMOKE FAILED ===' : '\n=== SMOKE PASSED ===');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
