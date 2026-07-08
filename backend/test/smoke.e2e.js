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

  const inv = await http('POST', '/rpc/invoke/cn-nodes/echo', { timeoutSeconds: 10, payload: { encode_str: 'hello' } }, admin);
  assert(inv.json.is_ok === true, 'invoke cn-nodes/echo -> is_ok true');
  assert(JSON.stringify(inv.json.payload) === JSON.stringify({ echo: { encode_str: 'hello' } }), 'invoke payload echoed');

  // 同一设备在两个组都能命中(多组设备)
  const inv2 = await http('POST', '/rpc/invoke/us-nodes/echo', { timeoutSeconds: 10, payload: { encode_str: 'world' } }, admin);
  assert(inv2.json.is_ok === true && inv2.json.clientId === 'dev-001', 'invoke us-nodes/echo -> same device is_ok true');

  const t0 = Date.now();
  const inv3 = await http('POST', '/rpc/invoke/cn-nodes/sleep', { timeoutSeconds: 2, payload: {} }, admin);
  assert(inv3.json.is_ok === false && inv3.json.status === 'timeout', 'invoke unanswered -> timeout');
  console.log('  timeout took ms: ' + (Date.now() - t0));

  const inv4 = await http('POST', '/rpc/invoke/ghost-group/echo', { payload: {} }, admin);
  assert(
    inv4.json.is_ok === false && (inv4.json.status === 'no_group' || inv4.json.status === 'no_device'),
    'invoke non-existent group -> no_group/no_device',
  );

  const list = await http('GET', '/monitor/requests?pageSize=3', null, admin);
  assert(Array.isArray(list.json.rows) && !('requestPayload' in (list.json.rows[0] || {})), 'monitor list has no payload');

  const m = await http('GET', '/metrics/overview', null, admin);
  assert(m.json.totals && typeof m.json.totals.total === 'number', 'metrics overview');

  ws.close();
  await sleep(200);
  console.log(failed ? '\n=== SMOKE FAILED ===' : '\n=== SMOKE PASSED ===');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
