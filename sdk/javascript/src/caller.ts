import { R2RpcHttpError } from './errors.js';
import type {
  DeviceOnlineStatus,
  JsonObjectValue,
  ProjectOnlineDevices,
  RpcInvokeOptions,
  RpcResponse,
} from './types.js';

export interface R2RpcCallerOptions {
  baseUrl: string;
  accessToken: string;
  requestTimeoutMilliseconds?: number;
  fetchImplementation?: typeof fetch;
}

export class R2RpcCaller {
  private readonly baseUrl: string;
  private readonly requestTimeoutMilliseconds: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: R2RpcCallerOptions) {
    if (!options.baseUrl.trim()) {
      throw new TypeError('baseUrl 不能为空');
    }
    if (!options.accessToken.trim()) {
      throw new TypeError('accessToken 不能为空');
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.requestTimeoutMilliseconds =
      options.requestTimeoutMilliseconds ?? 20_000;
    if (this.requestTimeoutMilliseconds <= 0) {
      throw new RangeError('requestTimeoutMilliseconds 必须大于 0');
    }
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  invoke(
    project: string,
    action: string,
    payload: JsonObjectValue,
    options: RpcInvokeOptions = {},
  ): Promise<RpcResponse> {
    ensureRequiredValue('project', project);
    ensureRequiredValue('action', action);
    if (
      options.timeoutSeconds !== undefined &&
      (!Number.isInteger(options.timeoutSeconds) ||
        options.timeoutSeconds < 1)
    ) {
      throw new RangeError('timeoutSeconds 必须是大于 0 的整数');
    }
    if (options.clientId !== undefined) {
      ensureRequiredValue('clientId', options.clientId);
    }
    const query = new URLSearchParams();
    if (options.clientId) {
      query.set('clientId', options.clientId);
    }
    const querySuffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.request<RpcResponse>(
      'POST',
      `/rpc/invoke/${encodeURIComponent(project)}/${encodeURIComponent(action)}${querySuffix}`,
      {
        payload,
        ...(options.timeoutSeconds === undefined
          ? {}
          : { timeoutSeconds: options.timeoutSeconds }),
      },
      options.signal,
    );
  }

  listOnlineDevices(project: string): Promise<ProjectOnlineDevices> {
    ensureRequiredValue('project', project);
    return this.request<ProjectOnlineDevices>(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(project)}`,
    );
  }

  isDeviceOnline(
    project: string,
    clientId: string,
  ): Promise<DeviceOnlineStatus> {
    ensureRequiredValue('project', project);
    ensureRequiredValue('clientId', clientId);
    return this.request<DeviceOnlineStatus>(
      'GET',
      `/rpc/clientQueue?project=${encodeURIComponent(project)}&clientId=${encodeURIComponent(clientId)}`,
    );
  }

  private async request<ResponseBody>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    externalSignal?: AbortSignal,
  ): Promise<ResponseBody> {
    const requestController = new AbortController();
    const timeout = setTimeout(
      () => requestController.abort(new Error('R2RPC 请求超时')),
      this.requestTimeoutMilliseconds,
    );
    const abortFromExternalSignal = () =>
      requestController.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', abortFromExternalSignal, {
      once: true,
    });
    if (externalSignal?.aborted) {
      abortFromExternalSignal();
    }
    try {
      const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: requestController.signal,
      });
      const responseText = await response.text();
      const responseBody = parseResponseBody(responseText);
      if (!response.ok) {
        throw new R2RpcHttpError(
          `${method} ${path} 失败: HTTP ${response.status}`,
          response.status,
          responseBody,
        );
      }
      return responseBody as ResponseBody;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternalSignal);
    }
  }
}

function parseResponseBody(responseText: string): unknown {
  if (!responseText) {
    return undefined;
  }
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return responseText;
  }
}

function ensureRequiredValue(name: string, value: string): void {
  if (!value.trim()) {
    throw new TypeError(`${name} 不能为空`);
  }
}
