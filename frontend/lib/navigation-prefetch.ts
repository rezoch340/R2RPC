import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { buildQueryString, requestApi } from "@/lib/api-client";
import type {
  CatalogPermission,
  DailyTrendPoint,
  DeviceRecord,
  MetricsOverview,
  PaginatedResponse,
  PermissionGroup,
  ProjectRecord,
  RequestLogRecord,
  SystemLogRecord,
  TokenRecord,
  UserRecord,
} from "@/lib/models";

interface NavigationPermission {
  action: string;
  subject: string;
}

interface NavigationPrefetchTask {
  permission?: NavigationPermission;
  prefetch: (queryClient: QueryClient) => Promise<void>;
}

type PermissionChecker = (action: string, subject: string) => boolean;

const EMPTY_REQUEST_LOG_FILTERS = {
  project: "",
  action: "",
  clientId: "",
  status: "",
  from: "",
  to: "",
};

const EMPTY_SYSTEM_LOG_FILTERS = {
  actorUsername: "",
  action: "",
  subject: "",
  status: "",
  from: "",
  to: "",
};

function createPrefetchTask<ResponseData>({
  queryKey,
  queryFunction,
  permission,
}: {
  queryKey: QueryKey;
  queryFunction: () => Promise<ResponseData>;
  permission?: NavigationPermission;
}): NavigationPrefetchTask {
  return {
    permission,
    async prefetch(queryClient) {
      await queryClient.prefetchQuery({
        queryKey,
        queryFn: queryFunction,
      });
    },
  };
}

const navigationPrefetchTasks: Record<string, NavigationPrefetchTask[]> = {
  "/": [
    createPrefetchTask({
      queryKey: ["metrics", "overview"],
      queryFunction: () => requestApi<MetricsOverview>("/metrics/overview"),
      permission: { action: "read", subject: "metrics" },
    }),
    createPrefetchTask({
      queryKey: ["metrics", "trend", 7],
      queryFunction: () =>
        requestApi<DailyTrendPoint[]>("/metrics/trend?days=7"),
      permission: { action: "read", subject: "metrics" },
    }),
    createPrefetchTask({
      queryKey: ["projects", "info"],
      queryFunction: () => requestApi<ProjectRecord[]>("/projects/info"),
      permission: { action: "read", subject: "project" },
    }),
    createPrefetchTask({
      queryKey: ["devices"],
      queryFunction: () => requestApi<DeviceRecord[]>("/devices"),
      permission: { action: "read", subject: "device" },
    }),
  ],
  "/projects": [
    createPrefetchTask({
      queryKey: ["projects", "info"],
      queryFunction: () => requestApi<ProjectRecord[]>("/projects/info"),
      permission: { action: "read", subject: "project" },
    }),
  ],
  "/devices": [
    createPrefetchTask({
      queryKey: ["devices"],
      queryFunction: () => requestApi<DeviceRecord[]>("/devices"),
      permission: { action: "read", subject: "device" },
    }),
  ],
  "/request-logs": [
    createPrefetchTask({
      queryKey: ["request-logs", EMPTY_REQUEST_LOG_FILTERS, 1, 20],
      queryFunction: () =>
        requestApi<PaginatedResponse<RequestLogRecord>>(
          `/monitor/requests${buildQueryString({
            ...EMPTY_REQUEST_LOG_FILTERS,
            page: 1,
            pageSize: 20,
          })}`,
        ),
      permission: { action: "read", subject: "monitor" },
    }),
  ],
  "/device-tokens": [
    createPrefetchTask({
      queryKey: ["device-tokens"],
      queryFunction: () => requestApi<TokenRecord[]>("/device-tokens"),
      permission: { action: "manage", subject: "device-token" },
    }),
    createPrefetchTask({
      queryKey: ["projects"],
      queryFunction: () => requestApi<ProjectRecord[]>("/projects"),
      permission: { action: "read", subject: "project" },
    }),
  ],
  "/access-tokens": [
    createPrefetchTask({
      queryKey: ["access-tokens"],
      queryFunction: () => requestApi<TokenRecord[]>("/access-tokens"),
      permission: { action: "manage", subject: "access-token" },
    }),
    createPrefetchTask({
      queryKey: ["projects"],
      queryFunction: () => requestApi<ProjectRecord[]>("/projects"),
      permission: { action: "read", subject: "project" },
    }),
  ],
  "/users": [
    createPrefetchTask({
      queryKey: ["users"],
      queryFunction: () => requestApi<UserRecord[]>("/users"),
      permission: { action: "read", subject: "user" },
    }),
    createPrefetchTask({
      queryKey: ["permission-groups"],
      queryFunction: () => requestApi<PermissionGroup[]>("/rbac/roles"),
      permission: { action: "read", subject: "rbac" },
    }),
  ],
  "/permission-groups": [
    createPrefetchTask({
      queryKey: ["permission-groups"],
      queryFunction: () => requestApi<PermissionGroup[]>("/rbac/roles"),
      permission: { action: "read", subject: "rbac" },
    }),
    createPrefetchTask({
      queryKey: ["permissions"],
      queryFunction: () => requestApi<CatalogPermission[]>("/rbac/permissions"),
      permission: { action: "read", subject: "rbac" },
    }),
  ],
  "/system-logs": [
    createPrefetchTask({
      queryKey: ["system-logs", EMPTY_SYSTEM_LOG_FILTERS, 1, 20],
      queryFunction: () =>
        requestApi<PaginatedResponse<SystemLogRecord>>(
          `/system-logs${buildQueryString({
            ...EMPTY_SYSTEM_LOG_FILTERS,
            page: 1,
            pageSize: 20,
          })}`,
        ),
      permission: { action: "read", subject: "system-log" },
    }),
  ],
};

export async function prefetchNavigationDestination({
  destination,
  queryClient,
  can,
}: {
  destination: string;
  queryClient: QueryClient;
  can: PermissionChecker;
}): Promise<void> {
  const permittedTasks = (navigationPrefetchTasks[destination] ?? []).filter(
    (prefetchTask) =>
      !prefetchTask.permission ||
      can(prefetchTask.permission.action, prefetchTask.permission.subject),
  );
  await Promise.allSettled(
    permittedTasks.map((prefetchTask) => prefetchTask.prefetch(queryClient)),
  );
}
