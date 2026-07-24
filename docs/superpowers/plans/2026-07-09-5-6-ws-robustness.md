# #5+#6: WS 健壮性(服务端 ping/读超时 + 帧上限/deadline)实现计划

> 状态：✅ 已完成，本文保留实施时任务顺序，不作为当前进度或测试命令真源。

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(推荐)。Steps 用 `- [ ]`。

**Goal:** #5 服务端主动 ping(5s)+ 读超时(20s 无活动)判离线断开;#6 单帧 4 MiB 上限(ws maxPayload)+ job `deadlineAt`(过期任务派发前丢弃)。

**范围决策(已核实 ws 8.21 限制):** #5 全做;#6 的 **maxPayload + deadlineAt** 做;**"拒分片(FIN=0)"延后** —— ws 高层 API 在 `onMessage` 时已重组帧、不暴露帧级 FIN,干净实现需自定义底层 receiver,得不偿失;maxPayload + 读超时已覆盖 DoS 面。

**Architecture:** ping/读超时按 socket 起 `setInterval`(5s):无活动(message/pong)超 20s 即 `terminate()`,否则 `ping()`;活动时间戳在 message/pong 更新;下线清 timer。maxPayload 走 `@WebSocketGateway` 装饰器常量(WsAdapter 透传给 ws.Server)。deadlineAt 由 invoke 的 timeout 算出进 job,`deliverLocalJob` 发送前 guard。阈值**硬编码常量**(不引 config,值固定)。

**Tech Stack:** NestJS 11 + `@nestjs/platform-ws`(ws 8.21)。

## Global Constraints
- 已在分支 `feat/5-6-ws-robustness`。功能分支 → PR → 合并。
- 提交/PR 前(`backend/`,**不用 `pnpm <script>`**,直接 `node_modules/.bin/{...}`):build+lint+format 全过。
- 无 schema/迁移改动。

## File Structure
- Modify `src/infrastructure/ws/ws.gateway.ts` — 装饰器加 maxPayload;handleConnection 加 ping/读超时 timer + 活动追踪;message 更新活动;handleDisconnect 清 timer。
- Modify `src/infrastructure/ws/protocol.ts` — `JobMessage` 加 `deadlineAt?`。
- Modify `src/application/rpc/rpc.service.ts` — job 加 `deadlineAt`。
- Modify `src/infrastructure/ws/connection.registry.ts` — `deliverLocalJob` 加 deadline guard。
- Modify `test/smoke.e2e.js` — 断言收到服务端 ping。

---

## Task 1: #6 maxPayload + deadlineAt

**Files:** `ws.gateway.ts`(装饰器), `protocol.ts`, `rpc.service.ts`, `connection.registry.ts`。

- [ ] **Step 1: ws.gateway 装饰器加 maxPayload 常量**

类上方加常量,装饰器用它:
```ts
// 单帧上限 4 MiB(ws.Server maxPayload,超限自动 close 1009);WsAdapter 透传装饰器选项
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

@WebSocketGateway({ path: '/api/client/ws', maxPayload: MAX_PAYLOAD_BYTES })
```

- [ ] **Step 2: protocol.ts JobMessage 加 deadlineAt**

```ts
export interface JobMessage {
  type: 'job';
  requestId: string;
  project: string;
  action: string;
  payload: unknown;
  timeoutSeconds: number;
  deadlineAt?: number; // epoch ms,过期任务派发前丢弃;0/缺省=无截止
}
```

- [ ] **Step 3: rpc.service job 加 deadlineAt**

定位 `const job = {`(invoke 里),加 `deadlineAt`:
```ts
      const job = {
        type: 'job',
        requestId,
        project: p.project,
        action: p.action,
        payload: p.payload,
        timeoutSeconds,
        deadlineAt: startedAt + timeoutMs, // startedAt/timeoutMs 已在 invoke 作用域
      };
```

- [ ] **Step 4: connection.registry deliverLocalJob 加 deadline guard**

`deliverLocalJob(clientId, job)` 里,取 socket 之后、send 之前加:
```ts
  private deliverLocalJob(clientId: string, job: unknown): boolean {
    const s = this.sockets.get(clientId);
    if (!s || s.readyState !== 1) return false;
    const deadlineAt = (job as { deadlineAt?: number }).deadlineAt;
    if (deadlineAt && Date.now() > deadlineAt) {
      this.logger.warn(`job 已过 deadline,丢弃: ${clientId}`);
      return false; // 过期不发(即时派发下极少触发;跨实例经 bus 到达时若已过期在此丢弃)
    }
    s.send(JSON.stringify(job));
    return true;
  }
```
> `cat connection.registry.ts` 核对现有 `deliverLocalJob`(有 `this.logger`)。返回 false → dispatchJob 返 false → invoke 走 unavailable/超时兜底。

- [ ] **Step 5: build + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -3
cd /Users/lpitiless/Documents/R2RPC && git add backend/src && git commit -m "feat(6): WS maxPayload 4MiB frame limit + job deadlineAt drop guard"
```

---

## Task 2: #5 服务端 ping + 读超时

**Files:** `ws.gateway.ts`。

- [ ] **Step 1: ClientSocket 加字段 + 常量**

`ClientSocket` 类型加:
```ts
type ClientSocket = WebSocket & {
  _clientId?: string;
  _projects?: number[];
  _maxInFlight?: number;
  _lastActivity?: number;
  _pingTimer?: NodeJS.Timeout;
};
```
类上方常量(maxPayload 旁):
```ts
const PING_INTERVAL_MS = 5000; // 服务端主动 ping
const READ_TIMEOUT_MS = 20000; // 无活动(message/pong)超此即判离线断开
```

- [ ] **Step 2: handleConnection 起 ping/读超时 + 活动追踪**

`socket.on('message', ...)` 回调里(转 raw 之前或之后)更新活动时间:
```ts
    socket.on('message', (data: RawData) => {
      socket._lastActivity = Date.now();
      const raw = Array.isArray(data)
        ? Buffer.concat(data).toString()
        : Buffer.isBuffer(data)
          ? data.toString()
          : Buffer.from(data).toString();
      void this.onMessage(socket, raw).catch(() => undefined);
    });
```
在 `this.send(socket, {type:'welcome',...})` 之后加 ping/读超时:
```ts
    // 服务端主动 ping + 读超时:无活动(message/pong)超 READ_TIMEOUT 即断开
    socket._lastActivity = Date.now();
    socket.on('pong', () => {
      socket._lastActivity = Date.now();
    });
    socket._pingTimer = setInterval(() => {
      if (socket.readyState !== 1) return;
      if (Date.now() - (socket._lastActivity ?? 0) > READ_TIMEOUT_MS) {
        this.logger.warn(`设备读超时(${READ_TIMEOUT_MS}ms 无活动),断开: ${socket._clientId}`);
        socket.terminate();
        return;
      }
      socket.ping();
    }, PING_INTERVAL_MS);
```

- [ ] **Step 3: handleDisconnect 清 timer**

`handleDisconnect` 开头加:
```ts
  async handleDisconnect(socket: ClientSocket) {
    if (socket._pingTimer) clearInterval(socket._pingTimer);
    const clientId = socket._clientId;
    // ...(现有不变)...
```

- [ ] **Step 4: build + lint + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/nest build 2>&1 | tail -3 && node_modules/.bin/eslint src/infrastructure/ws/ws.gateway.ts
cd /Users/lpitiless/Documents/R2RPC && git add backend/src/infrastructure/ws/ws.gateway.ts && git commit -m "feat(5): server-side WS ping (5s) + read-timeout (20s) terminate on inactivity"
```

---

## Task 3: 冒烟(收到服务端 ping)

**Files:** `test/smoke.e2e.js`。

- [ ] **Step 1: 加"收到服务端 ping"断言**

在 welcome/heartbeat 断言之后(设备 `ws` 已连),加(ws 库对服务端 ping 会自动回 pong;客户端可监听 'ping' 事件):
```ts
  // #5:服务端应在 ping 间隔内主动 ping 设备(ws 客户端自动回 pong)
  let gotServerPing = false;
  ws.on('ping', () => { gotServerPing = true; });
  await sleep(6000); // > PING_INTERVAL(5s),至少收到一次
  assert(gotServerPing, '收到服务端主动 ping(#5)');
```
> 6s 等待:ping 间隔 5s,6s 内必收到一次。放在 invoke 段之前或之后均可(设备连接存续期间)。放 heartbeatAck 断言之后即可。

- [ ] **Step 2: build + 起 API + 跑 smoke**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend
node_modules/.bin/nest build 2>&1 | tail -2
pkill -f 'node dist/main.js' 2>/dev/null; sleep 1
node dist/main.js > /tmp/api-56.log 2>&1 &
for i in $(seq 1 25); do curl -s -o /dev/null -X POST http://127.0.0.1:3000/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"admin123456"}' && break; sleep 1; done
node test/smoke.e2e.js 2>&1 | tail -20
pkill -f 'node dist/main.js' 2>/dev/null
```
Expected:全 PASS + `SMOKE PASSED`,含"收到服务端主动 ping"。FAIL 别提交。

- [ ] **Step 3: prettier + 提交**

```bash
cd /Users/lpitiless/Documents/R2RPC/backend && node_modules/.bin/prettier --write "test/**/*.js" >/dev/null
cd /Users/lpitiless/Documents/R2RPC && git add backend/test/smoke.e2e.js && git commit -m "test(5): assert server-side WS ping received"
```

---

## Task 4: 进度台账 + PR

**Files:** `docs/后端进度.md`。

- [ ] **Step 1: 台账 #5/#6 → ✅ + 完成记录**

- 总览表 `#5` ⬜→✅;`#6` ⬜→✅(注:拒分片延后)。
- #5/#6 段落标注完成 + 拒分片延后原因。
- 完成记录顶部加:
```markdown
### 2026-07-09 · #5+#6 WS 健壮性 — PR #<n>
- **#5**:服务端每 5s 主动 `ping`;按 socket 追踪活动(message/pong),无活动超 20s → `terminate()` 判离线。下线清 timer。
- **#6**:单帧 4 MiB 上限(`@WebSocketGateway maxPayload`,超限 ws 自动 close 1009);job 加 `deadlineAt`(=invoke startedAt+timeout),`deliverLocalJob` 发送前 guard 丢弃过期任务(即时派发下极少触发,跨实例 bus 到达时兜底)。
- **拒分片(FIN=0)延后**:ws 8.21 高层 API 不暴露帧级 FIN(onMessage 时已重组),maxPayload + 读超时已覆盖 DoS 面。
- 验证:build/lint/format 绿;e2e smoke 断言收到服务端 ping。
- 计划:`docs/superpowers/plans/2026-07-09-5-6-ws-robustness.md`。
```

- [ ] **Step 2: 提交 + 推 + PR**

```bash
cd /Users/lpitiless/Documents/R2RPC && git add docs/后端进度.md && git commit -m "docs(5+6): mark WS robustness done" && git push -u origin feat/5-6-ws-robustness && gh pr create --base main --title "feat(5+6): WS 健壮性(服务端 ping/读超时 + 帧上限/deadline)" --body "#5 服务端 ping(5s)+ 读超时(20s)判离线;#6 单帧 4MiB 上限 + job deadlineAt 丢弃。拒分片按 ws 限制延后。计划见 docs/superpowers/plans/2026-07-09-5-6-ws-robustness.md"
```

- [ ] **Step 3:** 回填 PR 号,补一提交。

---

## Self-Review
- **#5**:ping 5s + 无活动 20s terminate;活动 = message/pong 更新;下线 clearInterval 不泄 timer。
- **#6 maxPayload**:装饰器常量 4MiB,WsAdapter 透传给 ws.Server(已核实);超限自动 close 1009。
- **#6 deadlineAt**:进 job + deliverLocalJob guard;即时派发极少触发但补契约+守卫(跨实例延迟时兜底)。
- **拒分片延后**:ws API 限制,明确注明,DoS 面已被 maxPayload+读超时覆盖。
- **无环/无 DI 改动**:全在 ws.gateway/registry/protocol/rpc,常量硬编码(不引 config)。
- **类型一致**:ClientSocket 加 `_lastActivity/_pingTimer`;JobMessage 加 `deadlineAt?`;deliverLocalJob guard 读 `(job as {deadlineAt?}).deadlineAt`。
