import type { DailyTrendPoint } from '@/lib/models';
import { formatNumber } from '@/lib/format';

interface TrendPointCoordinate {
  xCoordinate: number;
  yCoordinate: number;
  trendPoint: DailyTrendPoint;
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 224;
const PLOT_TOP = 18;
const PLOT_BOTTOM = 184;
const PLOT_LEFT = 24;
const PLOT_RIGHT = 696;

function createSmoothLinePath(
  pointCoordinates: TrendPointCoordinate[],
): string {
  return pointCoordinates.reduce((path, pointCoordinate, pointIndex) => {
    if (pointIndex === 0) {
      return `M ${pointCoordinate.xCoordinate} ${pointCoordinate.yCoordinate}`;
    }

    const previousPoint = pointCoordinates[pointIndex - 1];
    const controlXCoordinate =
      (previousPoint.xCoordinate + pointCoordinate.xCoordinate) / 2;
    return `${path} C ${controlXCoordinate} ${previousPoint.yCoordinate}, ${controlXCoordinate} ${pointCoordinate.yCoordinate}, ${pointCoordinate.xCoordinate} ${pointCoordinate.yCoordinate}`;
  }, '');
}

export function TrendChart({ points }: { points: DailyTrendPoint[] }) {
  const maximumRequests = Math.max(
    1,
    ...points.map((trendPoint) => trendPoint.totalRequests),
  );
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;
  const pointCoordinates = points.map((trendPoint, pointIndex) => {
    const horizontalProgress =
      points.length === 1 ? 0.5 : pointIndex / (points.length - 1);
    return {
      xCoordinate: PLOT_LEFT + horizontalProgress * plotWidth,
      yCoordinate:
        PLOT_BOTTOM -
        (trendPoint.totalRequests / maximumRequests) * plotHeight,
      trendPoint,
    };
  });
  const linePath = createSmoothLinePath(pointCoordinates);
  const areaPath =
    pointCoordinates.length === 0
      ? ''
      : `${linePath} L ${pointCoordinates.at(-1)?.xCoordinate ?? PLOT_RIGHT} ${PLOT_BOTTOM} L ${pointCoordinates[0].xCoordinate} ${PLOT_BOTTOM} Z`;

  return (
    <div className="h-56 w-full">
      <svg
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="近 7 天请求趋势折线图"
      >
        <title>近 7 天请求趋势折线图</title>
        <defs>
          <linearGradient
            id="request-trend-area"
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {Array.from({ length: 5 }, (unusedValue, gridLineIndex) => {
          const yCoordinate =
            PLOT_TOP + (gridLineIndex / 4) * (PLOT_BOTTOM - PLOT_TOP);
          return (
            <line
              key={gridLineIndex}
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={yCoordinate}
              y2={yCoordinate}
              className="stroke-border"
              strokeWidth="1"
              strokeDasharray="4 6"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        <path d={areaPath} fill="url(#request-trend-area)" />
        <path
          d={linePath}
          fill="none"
          className="stroke-primary"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {pointCoordinates.map((pointCoordinate) => {
          const tooltipWidth = 112;
          const tooltipXCoordinate = Math.min(
            CHART_WIDTH - tooltipWidth,
            Math.max(0, pointCoordinate.xCoordinate - tooltipWidth / 2),
          );
          const tooltipYCoordinate =
            pointCoordinate.yCoordinate < 48
              ? pointCoordinate.yCoordinate + 14
              : pointCoordinate.yCoordinate - 40;
          return (
            <g
              key={pointCoordinate.trendPoint.statDate}
              className="group outline-none"
              tabIndex={0}
              aria-label={`${pointCoordinate.trendPoint.statDate}，${formatNumber(pointCoordinate.trendPoint.totalRequests)} 次请求`}
            >
              <title>
                {pointCoordinate.trendPoint.statDate}：
                {formatNumber(pointCoordinate.trendPoint.totalRequests)} 次
              </title>
              <circle
                cx={pointCoordinate.xCoordinate}
                cy={pointCoordinate.yCoordinate}
                r="13"
                className="cursor-default fill-transparent"
              />
              <circle
                cx={pointCoordinate.xCoordinate}
                cy={pointCoordinate.yCoordinate}
                r="4.5"
                className="fill-card stroke-primary"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
              <g className="pointer-events-none opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                <rect
                  x={tooltipXCoordinate}
                  y={tooltipYCoordinate}
                  width={tooltipWidth}
                  height="28"
                  rx="7"
                  className="fill-foreground"
                />
                <text
                  x={tooltipXCoordinate + tooltipWidth / 2}
                  y={tooltipYCoordinate + 18}
                  textAnchor="middle"
                  className="fill-background font-mono text-[10px]"
                >
                  {formatNumber(
                    pointCoordinate.trendPoint.totalRequests,
                  )}{' '}
                  次
                </text>
              </g>
              <text
                x={pointCoordinate.xCoordinate}
                y={CHART_HEIGHT - 10}
                textAnchor="middle"
                className="fill-muted-foreground font-mono text-[9px]"
              >
                {pointCoordinate.trendPoint.statDate.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
