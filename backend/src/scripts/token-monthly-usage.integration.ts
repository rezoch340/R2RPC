// 内部集成检查（非 E2E）:直连 PG/Redis 验证 access token 当月计数与重置。
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { AccessTokenService } from '../application/access-token/access-token.service';
import { accessTokens } from '../application/access-token/access-token.schema';
import { ProjectsService } from '../application/projects/projects.service';
import { ConfigService } from '../infrastructure/config/config.service';
import { DbService } from '../infrastructure/db/db.service';
import { RedisCacheAsideService } from '../infrastructure/redis/redis-cache-aside.service';
import { RedisService } from '../infrastructure/redis/redis.service';

const PROBE_TOKEN = 'rk_monthly-usage-probe';
const PROBE_NAME = 'monthly-usage-probe';

type Database = NodePgDatabase<Record<string, never>>;
type CheckFunction = (condition: boolean, message: string) => void;

interface UsageSnapshot {
  usageCount: number;
  monthlyUsageCount: number;
  usagePeriod: string | null;
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

async function snapshot(database: Database): Promise<UsageSnapshot> {
  const [record] = await database
    .select({
      usageCount: accessTokens.usageCount,
      monthlyUsageCount: accessTokens.monthlyUsageCount,
      usagePeriod: accessTokens.usagePeriod,
    })
    .from(accessTokens)
    .where(eq(accessTokens.token, PROBE_TOKEN))
    .limit(1);
  return record;
}

// 每个场景自带种子,互不干扰;返回新建 token 的编号
async function seedProbe(
  database: Database,
  maximumUsageCount: number | null,
): Promise<number> {
  await database
    .delete(accessTokens)
    .where(eq(accessTokens.token, PROBE_TOKEN));
  const [created] = await database
    .insert(accessTokens)
    .values({
      name: PROBE_NAME,
      token: PROBE_TOKEN,
      status: 'active',
      maximumUsageCount,
    })
    .returning({ id: accessTokens.id });
  return created.id;
}

// 热路径消耗只动总次数;当月计数由 Worker 侧的 recordMonthlyUsage 独立累加
async function checkCountsAreRecordedSeparately(
  database: Database,
  tokenService: AccessTokenService,
  check: CheckFunction,
): Promise<void> {
  const tokenId = await seedProbe(database, 5);
  await tokenService.consumeInvocation(tokenId);
  await tokenService.consumeInvocation(tokenId);
  const afterConsume = await snapshot(database);
  check(
    afterConsume.usageCount === 2,
    `限量 token 总次数为 2(实际 ${afterConsume.usageCount})`,
  );
  check(
    afterConsume.monthlyUsageCount === 0,
    `热路径消耗不写当月计数(实际 ${afterConsume.monthlyUsageCount})`,
  );
  await tokenService.recordMonthlyUsage(tokenId);
  await tokenService.recordMonthlyUsage(tokenId);
  const afterRecord = await snapshot(database);
  check(
    afterRecord.monthlyUsageCount === 2,
    `Worker 补记两次后当月计数为 2(实际 ${afterRecord.monthlyUsageCount})`,
  );
  check(
    afterRecord.usageCount === 2,
    `补记当月不影响总次数(实际 ${afterRecord.usageCount})`,
  );
  check(
    afterRecord.usagePeriod === currentPeriod(),
    `周期键为当月 UTC(实际 ${afterRecord.usagePeriod})`,
  );
}

// 跨月:周期对不上时当月计数从 1 重开
async function checkMonthRollover(
  database: Database,
  tokenService: AccessTokenService,
  check: CheckFunction,
): Promise<void> {
  const tokenId = await seedProbe(database, 5);
  await tokenService.recordMonthlyUsage(tokenId);
  await database
    .update(accessTokens)
    .set({ usagePeriod: '2000-01', monthlyUsageCount: 999 })
    .where(eq(accessTokens.id, tokenId));
  await tokenService.recordMonthlyUsage(tokenId);
  const usage = await snapshot(database);
  check(
    usage.monthlyUsageCount === 1,
    `跨月后当月计数重置为 1(实际 ${usage.monthlyUsageCount})`,
  );
  check(
    usage.usagePeriod === currentPeriod(),
    `跨月后周期键归位当月(实际 ${usage.usagePeriod})`,
  );
}

// 手动重置:两个计数一并清零,周期归位当月
async function checkManualReset(
  database: Database,
  tokenService: AccessTokenService,
  check: CheckFunction,
): Promise<void> {
  const tokenId = await seedProbe(database, 5);
  await tokenService.consumeInvocation(tokenId);
  await tokenService.recordMonthlyUsage(tokenId);
  await tokenService.resetUsage(tokenId);
  const usage = await snapshot(database);
  check(
    usage.usageCount === 0 && usage.monthlyUsageCount === 0,
    `重置后两个计数均为 0(实际 总 ${usage.usageCount} 月 ${usage.monthlyUsageCount})`,
  );
  check(usage.usagePeriod === currentPeriod(), '重置后周期键归位当月');
}

// 不限量 token:当月计数照记,总次数保持 0(与「N / 不限」展示一致)
async function checkUnlimitedToken(
  database: Database,
  tokenService: AccessTokenService,
  check: CheckFunction,
): Promise<void> {
  const tokenId = await seedProbe(database, null);
  await tokenService.recordMonthlyUsage(tokenId);
  await tokenService.recordMonthlyUsage(tokenId);
  const usage = await snapshot(database);
  check(
    usage.monthlyUsageCount === 2,
    `不限量 token 当月计数为 2(实际 ${usage.monthlyUsageCount})`,
  );
  check(
    usage.usageCount === 0,
    `不限量 token 总次数保持 0(实际 ${usage.usageCount})`,
  );
}

// 次数用尽:整条 UPDATE 不命中,总次数不再增长(该次调用被 429 拦在写日志之前,
// 因此 Worker 也不会补记当月)
async function checkExhaustedToken(
  database: Database,
  tokenService: AccessTokenService,
  check: CheckFunction,
): Promise<void> {
  const tokenId = await seedProbe(database, 1);
  await tokenService.consumeInvocation(tokenId);
  const beforeRejected = await snapshot(database);
  await tokenService.consumeInvocation(tokenId).catch(() => undefined);
  const afterRejected = await snapshot(database);
  check(
    afterRejected.usageCount === beforeRejected.usageCount,
    `次数用尽后总次数不再增长(实际 ${afterRejected.usageCount})`,
  );
}

// 当月计数只记数不限流 + 跨月懒清零 + 手动重置。用法: pnpm test:integration:token-monthly-usage
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
  // 用真实 service,只喂它需要的依赖(不启 Nest DI);ProjectsService 在本检查里用不到
  const tokenService = new AccessTokenService(
    { database } as unknown as DbService,
    {} as unknown as ProjectsService,
    new RedisCacheAsideService({
      client: redisClient,
    } as unknown as RedisService),
  );

  let allChecksPassed = true;
  const check: CheckFunction = (condition, message) => {
    console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
    if (!condition) {
      allChecksPassed = false;
    }
  };

  await checkCountsAreRecordedSeparately(database, tokenService, check);
  await checkMonthRollover(database, tokenService, check);
  await checkManualReset(database, tokenService, check);
  await checkUnlimitedToken(database, tokenService, check);
  await checkExhaustedToken(database, tokenService, check);

  // 清种子
  await database
    .delete(accessTokens)
    .where(eq(accessTokens.token, PROBE_TOKEN));
  await redisClient.quit();
  await connectionPool.end();
  console.log(
    allChecksPassed
      ? '\n=== TOKEN MONTHLY USAGE SMOKE PASSED ==='
      : '\n=== TOKEN MONTHLY USAGE SMOKE FAILED ===',
  );
  process.exit(allChecksPassed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
