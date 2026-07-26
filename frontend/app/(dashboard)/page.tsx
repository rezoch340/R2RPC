'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Clock3,
  Cpu,
  FolderKanban,
  RadioTower,
} from 'lucide-react';
import { QueryErrorState } from '@/components/query-state';
import { StatCard } from '@/components/stat-card';
import { TrendChart } from '@/components/trend-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { requestApi } from '@/lib/api-client';
import { useAuthentication } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import type {
  DailyTrendPoint,
  DeviceRecord,
  MetricsOverview,
  PaginatedResponse,
  ProjectRecord,
} from '@/lib/models';

export default function OverviewPage() {
  const { can } = useAuthentication();
  const canReadMetrics = can('read', 'metrics');
  const canReadProjects = can('read', 'project');
  const canReadDevices = can('read', 'device');

  const metricsQuery = useQuery({
    queryKey: ['metrics', 'overview'],
    queryFn: () => requestApi<MetricsOverview>('/metrics/overview'),
    enabled: canReadMetrics,
    refetchInterval: 30_000,
  });
  const trendQuery = useQuery({
    queryKey: ['metrics', 'trend', 7],
    queryFn: () =>
      requestApi<DailyTrendPoint[]>('/metrics/trend?days=7'),
    enabled: canReadMetrics,
    refetchInterval: 30_000,
  });
  const projectsQuery = useQuery({
    queryKey: ['projects', 'info'],
    queryFn: () => requestApi<ProjectRecord[]>('/projects/info'),
    enabled: canReadProjects,
  });
  // 概览只要两个计数,取 pageSize=1 的 total,不把设备整表拉到浏览器
  const deviceCountQuery = useQuery({
    queryKey: ['devices', 'count'],
    queryFn: () =>
      requestApi<PaginatedResponse<DeviceRecord>>('/devices?page=1&pageSize=1'),
    enabled: canReadDevices,
    refetchInterval: 15_000,
  });
  const onlineDeviceCountQuery = useQuery({
    queryKey: ['devices', 'count', 'online'],
    queryFn: () =>
      requestApi<PaginatedResponse<DeviceRecord>>(
        '/devices?page=1&pageSize=1&status=online',
      ),
    enabled: canReadDevices,
    refetchInterval: 15_000,
  });
  const requestTotals = metricsQuery.data?.totals;

  return (
    <>
      <section className="relative overflow-hidden rounded-3xl bg-[#07171d] px-6 py-10 text-white shadow-xl sm:px-10">
        <div
          className="absolute inset-0 opacity-35"
          style={{
            background:
              'radial-gradient(circle at 18% 0%, rgba(34,211,238,.5), transparent 26rem), radial-gradient(circle at 90% 100%, rgba(14,116,144,.45), transparent 30rem)',
          }}
        />
        <div
          className="relay-flow absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              'repeating-linear-gradient(118deg, rgba(255,255,255,.12) 0 1px, transparent 1px 30px)',
          }}
        />
        <div className="relative max-w-3xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-cyan-200 uppercase">
            <RadioTower className="size-3.5" />
            Relay control plane
          </div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
            运行概览
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-white/55">
            汇总设备在线态、RPC 请求量和端到端延迟。冷路径指标每 30
            秒自动刷新，设备状态每 15 秒刷新。
          </p>
        </div>
      </section>

      {metricsQuery.isError ? (
        <QueryErrorState message="指标接口加载失败，请确认 API 与 Worker 正常运行。" />
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="累计请求"
          value={
            canReadMetrics && requestTotals
              ? formatNumber(requestTotals.total)
              : '—'
          }
          hint="请求日志脊柱总量"
          icon={Activity}
        />
        <StatCard
          label="在线设备"
          value={
            canReadDevices && onlineDeviceCountQuery.data
              ? formatNumber(onlineDeviceCountQuery.data.total)
              : '—'
          }
          hint={`登记设备 ${formatNumber(deviceCountQuery.data?.total)}`}
          icon={Cpu}
        />
        <StatCard
          label="功能组"
          value={
            canReadProjects && projectsQuery.data
              ? formatNumber(projectsQuery.data.length)
              : '—'
          }
          hint={`运行中 ${formatNumber(projectsQuery.data?.filter((project) => project.enabled).length)}`}
          icon={FolderKanban}
        />
        <StatCard
          label="平均延迟"
          value={
            canReadMetrics && requestTotals
              ? `${formatNumber(requestTotals.avgLatencyMs)} ms`
              : '—'
          }
          hint={`失败 ${formatNumber(requestTotals?.failed)}`}
          icon={Clock3}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="border-0 shadow-sm ring-1 ring-border">
          <CardHeader>
            <CardTitle>近 7 天请求趋势</CardTitle>
          </CardHeader>
          <CardContent>
            {trendQuery.isLoading ? (
              <Skeleton className="h-56 w-full" />
            ) : trendQuery.data && trendQuery.data.length > 0 ? (
              <TrendChart points={trendQuery.data} />
            ) : (
              <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                暂无趋势数据
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm ring-1 ring-border">
          <CardHeader>
            <CardTitle>状态分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {metricsQuery.data?.byStatus.map((statusMetric) => {
              const totalRequests = Math.max(
                1,
                metricsQuery.data?.totals.total ?? 1,
              );
              const widthPercentage =
                (statusMetric.count / totalRequests) * 100;
              return (
                <div key={statusMetric.status} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono">{statusMetric.status}</span>
                    <span className="text-muted-foreground">
                      {formatNumber(statusMetric.count)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${widthPercentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {!metricsQuery.isLoading &&
            (metricsQuery.data?.byStatus.length ?? 0) === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                暂无状态数据
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
