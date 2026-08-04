// 内部集成检查（非 E2E）:直连 PG/Redis 验证闲置设备软删与重连回滚。
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DevicesService } from '../application/devices/devices.service';
import { devices } from '../application/devices/devices.schema';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';
import { RedisService } from '../infrastructure/redis/redis.service';

const IDLE_DELETE_DAYS = 3;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
// device_token_id 可空且带外键;探针不种令牌,直接留空避免外键约束
const NO_DEVICE_TOKEN = null as unknown as number;

const IDLE_CLIENT_ID = 'idle-sweep-probe-idle';
const RECENT_CLIENT_ID = 'idle-sweep-probe-recent';
const ONLINE_CLIENT_ID = 'idle-sweep-probe-online';
const PROBE_CLIENT_IDS = [IDLE_CLIENT_ID, RECENT_CLIENT_ID, ONLINE_CLIENT_ID];

type Database = NodePgDatabase<Record<string, never>>;
type CheckFunction = (condition: boolean, message: string) => void;

async function seedProbes(database: Database): Promise<void> {
  const longIdleSeenAt = new Date(Date.now() - 5 * DAY_MILLISECONDS);
  await database.insert(devices).values([
    // 早就没再上线,应被软删
    {
      clientId: IDLE_CLIENT_ID,
      online: false,
      status: 'offline',
      lastSeenAt: longIdleSeenAt,
    },
    // 昨天还在,不该动
    {
      clientId: RECENT_CLIENT_ID,
      online: false,
      status: 'offline',
      lastSeenAt: new Date(Date.now() - DAY_MILLISECONDS),
    },
    // 时间戳很旧但仍标在线(lastSeenAt 刷新链路断过),不该动
    {
      clientId: ONLINE_CLIENT_ID,
      online: true,
      status: 'online',
      lastSeenAt: longIdleSeenAt,
    },
  ]);
}

async function isSoftDeleted(
  database: Database,
  clientId: string,
): Promise<boolean> {
  const [record] = await database
    .select({ deletedAt: devices.deletedAt })
    .from(devices)
    .where(eq(devices.clientId, clientId))
    .limit(1);
  return Boolean(record?.deletedAt);
}

async function checkIdleSweep(
  database: Database,
  devicesService: DevicesService,
  check: CheckFunction,
): Promise<void> {
  const deletedCount = await devicesService.softDeleteIdle(IDLE_DELETE_DAYS);
  check(
    deletedCount >= 1,
    `softDeleteIdle 至少软删 1 台(实际 ${deletedCount})`,
  );
  check(
    await isSoftDeleted(database, IDLE_CLIENT_ID),
    '超期未上线的设备被软删',
  );
  check(
    !(await isSoftDeleted(database, RECENT_CLIENT_ID)),
    '近期在线过的设备不被软删',
  );
  check(
    !(await isSoftDeleted(database, ONLINE_CLIENT_ID)),
    'online=true 的设备即使时间戳陈旧也不被软删',
  );
}

// 软删设备重连必须复用原行(回滚软删),而不是插一条新的
async function checkReconnectRollback(
  database: Database,
  devicesService: DevicesService,
  check: CheckFunction,
): Promise<void> {
  const [beforeReconnect] = await database
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.clientId, IDLE_CLIENT_ID))
    .limit(1);
  await devicesService.registerOnline(IDLE_CLIENT_ID, NO_DEVICE_TOKEN, {
    platform: 'integration-probe',
  });
  const reconnectedRows = await database
    .select({ id: devices.id, deletedAt: devices.deletedAt })
    .from(devices)
    .where(eq(devices.clientId, IDLE_CLIENT_ID));
  check(
    reconnectedRows.length === 1,
    `重连后该 clientId 仍只有 1 行(实际 ${reconnectedRows.length} 行)`,
  );
  check(
    reconnectedRows[0]?.id === beforeReconnect?.id,
    '重连复用原设备行(id 不变)',
  );
  check(reconnectedRows[0]?.deletedAt === null, '重连后软删被回滚');
}

// 已有活行时不得再把软删行也复活(否则撞 client_id 的 partial unique)
async function checkAliveRowWins(
  database: Database,
  devicesService: DevicesService,
  check: CheckFunction,
): Promise<void> {
  await database
    .update(devices)
    .set({ deletedAt: new Date() })
    .where(eq(devices.clientId, IDLE_CLIENT_ID));
  await database.insert(devices).values({
    clientId: IDLE_CLIENT_ID,
    online: false,
    status: 'offline',
    lastSeenAt: new Date(),
  });
  await devicesService.registerOnline(IDLE_CLIENT_ID, NO_DEVICE_TOKEN, {});
  const [aliveRows] = await database
    .select({ total: sql<number>`count(*)::int` })
    .from(devices)
    .where(
      and(eq(devices.clientId, IDLE_CLIENT_ID), isNull(devices.deletedAt)),
    );
  check(
    aliveRows?.total === 1,
    `存在活行时重连不复活软删行(活行 ${aliveRows?.total} 条)`,
  );
}

// 闲置软删 + 重连回滚(无 API 面 → 直连 PG+Redis)。用法: pnpm test:integration:device-idle-sweep
async function main() {
  const configuration = new ConfigService();
  const connectionPool = new Pool(configuration.db);
  const database = drizzle(connectionPool) as Database;
  const redisClient = new Redis({
    host: configuration.redis.host,
    port: configuration.redis.port,
    password: configuration.redis.password ?? undefined,
    db: configuration.redis.db,
  });
  // 用真实 service,只喂它需要的 { db } / { client }(不启 Nest DI)
  const devicesService = new DevicesService(
    { database } as unknown as DbService,
    { client: redisClient } as unknown as RedisService,
  );

  let allChecksPassed = true;
  const check: CheckFunction = (condition, message) => {
    console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
    if (!condition) {
      allChecksPassed = false;
    }
  };

  const clearProbes = async () => {
    for (const clientId of PROBE_CLIENT_IDS) {
      await database.delete(devices).where(eq(devices.clientId, clientId));
    }
  };

  await clearProbes(); // 清残留
  await seedProbes(database);
  await checkIdleSweep(database, devicesService, check);
  await checkReconnectRollback(database, devicesService, check);
  await checkAliveRowWins(database, devicesService, check);
  await clearProbes(); // 清种子

  await redisClient.quit();
  await connectionPool.end();
  console.log(
    allChecksPassed
      ? '\n=== DEVICE IDLE SWEEP SMOKE PASSED ==='
      : '\n=== DEVICE IDLE SWEEP SMOKE FAILED ===',
  );
  process.exit(allChecksPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
