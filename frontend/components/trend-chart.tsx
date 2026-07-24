import type { DailyTrendPoint } from '@/lib/models';
import { formatNumber } from '@/lib/format';

export function TrendChart({ points }: { points: DailyTrendPoint[] }) {
  const maximumRequests = Math.max(
    1,
    ...points.map((trendPoint) => trendPoint.totalRequests),
  );
  return (
    <div className="flex h-56 items-end gap-2 pt-6">
      {points.map((trendPoint) => {
        const heightPercentage =
          (trendPoint.totalRequests / maximumRequests) * 100;
        return (
          <div
            key={trendPoint.statDate}
            className="group flex min-w-0 flex-1 flex-col items-center gap-2"
          >
            <div className="relative flex h-40 w-full items-end justify-center">
              <div className="pointer-events-none absolute -top-7 hidden rounded-md bg-foreground px-2 py-1 font-mono text-[10px] text-background group-hover:block">
                {formatNumber(trendPoint.totalRequests)} 次
              </div>
              <div
                className="w-full max-w-10 rounded-t-md bg-gradient-to-t from-primary to-cyan-300 transition-all group-hover:brightness-110"
                style={{
                  height: `${Math.max(3, heightPercentage)}%`,
                }}
              />
            </div>
            <span className="truncate font-mono text-[9px] text-muted-foreground">
              {trendPoint.statDate.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
