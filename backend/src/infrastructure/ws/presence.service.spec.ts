import type { RedisService } from '../redis/redis.service';
import { PresenceService } from './presence.service';

describe('PresenceService maxInFlight normalization', () => {
  const presenceService = new PresenceService({
    client: {},
  } as unknown as RedisService);

  it('uses the conservative default when the device omits capacity', () => {
    expect(presenceService.clampMaxInFlight(undefined)).toBe(16);
    expect(presenceService.clampMaxInFlight(null)).toBe(16);
    expect(presenceService.clampMaxInFlight('')).toBe(16);
  });

  it('uses the conservative default for invalid or non-positive values', () => {
    expect(presenceService.clampMaxInFlight('invalid')).toBe(16);
    expect(presenceService.clampMaxInFlight('4.5')).toBe(16);
    expect(presenceService.clampMaxInFlight(0)).toBe(16);
    expect(presenceService.clampMaxInFlight(-8)).toBe(16);
  });

  it('preserves low device-reported capacity', () => {
    expect(presenceService.clampMaxInFlight(1)).toBe(1);
    expect(presenceService.clampMaxInFlight(4)).toBe(4);
    expect(presenceService.clampMaxInFlight('16')).toBe(16);
  });

  it('caps only values above the server maximum', () => {
    expect(presenceService.clampMaxInFlight(1024)).toBe(1024);
    expect(presenceService.clampMaxInFlight(4096)).toBe(1024);
  });
});
