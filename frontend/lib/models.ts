export interface PermissionTuple {
  action: string;
  subject: string;
}

export interface CatalogPermission extends PermissionTuple {
  id: number;
  description?: string | null;
}

export interface AuthenticatedUser {
  id: number;
  username: string;
  isRoot: boolean;
  permissions: PermissionTuple[];
}

export interface UserRecord {
  id: number;
  username: string;
  role: string;
  isRoot: boolean;
  enabled: boolean;
  description: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ProjectRecord {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  createdAt?: string;
}

// 派生统计单列返回:运行态由设备聚合推导，不是库里的列，因此不能作为筛选条件
export interface ProjectStats {
  projectId: number;
  totalDevices: number;
  onlineDevices: number;
  lastSeenAt: string | null;
  requests7d: number;
  success7d: number;
  successRate: number;
  status: string;
}

export interface TokenRecord {
  id: number;
  name: string;
  token: string;
  status: string;
  projects: string[];
  expiresAt?: string | null;
  maximumUsageCount?: number | null;
  usageCount?: number;
  // 当月调用计数，跨月自动归零；只用于展示，不参与限流
  monthlyUsageCount?: number;
  description: string | null;
  createdBy: number | null;
  createdAt: string;
  onlineDeviceCount?: number;
}

export interface DeviceRecord {
  id: number;
  clientId: string;
  deviceTokenId: number | null;
  online: boolean;
  status: string;
  platform: string | null;
  lastIp: string | null;
  extra: string | null;
  maxInFlight: number | null;
  description: string | null;
  lastSeenAt: string | null;
}

export interface PermissionGroup {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  permissions: CatalogPermission[];
}

export interface MetricsOverview {
  totals: {
    total: number;
    ok: number;
    failed: number;
    avgLatencyMs: number;
  };
  byStatus: Array<{ status: string; count: number }>;
  byProject: Array<{ project: string; count: number }>;
}

export interface DailyTrendPoint {
  statDate: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  timeoutRequests: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  successRate: number;
}

export interface RequestLogRecord {
  id: number;
  requestId: string;
  projectName: string;
  actionName: string;
  clientId: string | null;
  // 调用方自带的业务单号，未提供为 null；完整显示，不脱敏
  clientRequestId: string | null;
  requesterUserId: number | null;
  accessTokenId: number | null;
  status: string;
  httpCode: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  payloadState: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface AppAuditStep {
  sequence: number;
  code?: string;
  name: string;
  startedAt: string;
  durationMs: number;
  status?: number | string;
  request?: unknown;
  response?: unknown;
  error?: unknown;
}

export interface RequestLogDetail extends RequestLogRecord {
  payloadUnavailable: boolean;
  requestPayload: unknown;
  responsePayload: unknown;
  appAudit: {
    schemaVersion: 1;
    title: string;
    metadata: Array<{ key: string; value: unknown }>;
    steps: AppAuditStep[];
  } | null;
}

export interface PaginatedResponse<RowType> {
  rows: RowType[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SystemLogRecord {
  id: number;
  name: string;
  description: string;
  actorUserId: number;
  actorUsername: string;
  action: string;
  subject: string;
  targetType: string;
  targetId: string | null;
  targetName: string | null;
  metadata: Record<string, unknown>;
  method: string;
  route: string;
  status: 'succeeded' | 'failed';
  statusCode: number;
  errorMessage: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface RpcDebugProject {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
}

export interface RpcDebugOptions {
  projects: RpcDebugProject[];
  actions: string[];
  clientIds: string[];
}

export interface RpcInvokeResponse {
  requestId: string;
  clientId: string | null;
  is_ok: boolean;
  status: string;
  httpCode: number;
  latencyMs: number;
  payload?: unknown;
  error?: string;
}

// 仪表盘专用聚合：一次返回两组计数、请求指标与近 7 天趋势
export interface DashboardOverview {
  projects: { total: number; enabled: number };
  devices: { total: number; online: number };
  requests: MetricsOverview;
  trend: DailyTrendPoint[];
}
