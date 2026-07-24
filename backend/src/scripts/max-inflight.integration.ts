// 内部集成检查（非 E2E）:直连 Redis 验证在途槽原子算法。
import Redis from 'ioredis';
import { PresenceService } from '../infrastructure/ws/presence.service';
import { ConfigService } from '../infrastructure/config/config.service';
import { RedisService } from '../infrastructure/redis/redis.service';

// 在途限流冒烟(无 API 面 → 直连 Redis):tryAcquireSlot 到上限即拒,release 后可再占。
class CheckReporter {
  allChecksPassed = true;

  check(condition: boolean, message: string): void {
    console.log((condition ? 'PASS' : 'FAIL') + ': ' + message);
    if (!condition) {
      this.allChecksPassed = false;
    }
  }
}

async function main() {
  const configuration = new ConfigService();
  const redisClient = new Redis({
    host: configuration.redis.host,
    port: configuration.redis.port,
    password: configuration.redis.password ?? undefined,
    db: configuration.redis.db,
  });
  const presenceService = new PresenceService({
    client: redisClient,
  } as unknown as RedisService);
  const reporter = new CheckReporter();

  await verifySingleDeviceLimits(presenceService, reporter);
  await verifyRoundRobinSelection(presenceService, reporter);

  await redisClient.quit();
  console.log(
    reporter.allChecksPassed
      ? '\n=== MAXINFLIGHT SMOKE PASSED ==='
      : '\n=== MAXINFLIGHT SMOKE FAILED ===',
  );
  process.exit(reporter.allChecksPassed ? 0 : 1);
}

async function verifySingleDeviceLimits(
  presenceService: PresenceService,
  reporter: CheckReporter,
): Promise<void> {
  const clientId = 'maxinflight-smoke-probe';
  const maximumInFlight = 3;
  await presenceService.resetInFlight(clientId);

  const firstAcquired = await presenceService.tryAcquireSlot(
    clientId,
    maximumInFlight,
  );
  const secondAcquired = await presenceService.tryAcquireSlot(
    clientId,
    maximumInFlight,
  );
  const thirdAcquired = await presenceService.tryAcquireSlot(
    clientId,
    maximumInFlight,
  );
  reporter.check(
    firstAcquired && secondAcquired && thirdAcquired,
    '占满 3 个槽(max=3)',
  );

  const overLimitAcquired = await presenceService.tryAcquireSlot(
    clientId,
    maximumInFlight,
  );
  reporter.check(!overLimitAcquired, '第 4 个超上限被拒(rejected)');

  await presenceService.releaseSlot(clientId);
  const acquiredAfterRelease = await presenceService.tryAcquireSlot(
    clientId,
    maximumInFlight,
  );
  reporter.check(acquiredAfterRelease, 'release 一个后可再占');

  await presenceService.resetInFlight(clientId);
  await presenceService.releaseSlot(clientId);
  const acquiredAfterUnderflow = await presenceService.tryAcquireSlot(
    clientId,
    maximumInFlight,
  );
  reporter.check(acquiredAfterUnderflow, 'release 到负后兜底 0,仍可占');
  await presenceService.resetInFlight(clientId);
}

async function verifyRoundRobinSelection(
  presenceService: PresenceService,
  reporter: CheckReporter,
): Promise<void> {
  const projectId = 999999;
  const saturatedClientId = 'pick-smoke-d1';
  const availableClientId = 'pick-smoke-d2';
  await presenceService.offline(saturatedClientId, [projectId]);
  await presenceService.offline(availableClientId, [projectId]);

  const emptySelection = await presenceService.pickOnlineAcquire(projectId);
  reporter.check(emptySelection === 'no_device', '空组 → no_device');

  await presenceService.online(saturatedClientId, [projectId]);
  await presenceService.online(availableClientId, [projectId]);
  await presenceService.setMaxInFlight(saturatedClientId, 1);
  await presenceService.setMaxInFlight(availableClientId, 8);
  await presenceService.resetInFlight(saturatedClientId);
  await presenceService.resetInFlight(availableClientId);
  await presenceService.tryAcquireSlot(saturatedClientId, 1);

  const availableSelection = await presenceService.pickOnlineAcquire(projectId);
  reporter.check(
    typeof availableSelection !== 'string' &&
      availableSelection.clientId === availableClientId,
    '跳过已满的 d1,选中并占 d2',
  );

  for (let slotNumber = 1; slotNumber < 8; slotNumber += 1) {
    await presenceService.tryAcquireSlot(availableClientId, 8);
  }
  const saturatedSelection = await presenceService.pickOnlineAcquire(projectId);
  reporter.check(saturatedSelection === 'saturated', '全满 → saturated');

  await presenceService.offline(saturatedClientId, [projectId]);
  await presenceService.offline(availableClientId, [projectId]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
