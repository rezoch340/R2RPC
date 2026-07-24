'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ApiRequestError,
  buildQueryString,
  getRequestErrorMessage,
  requestApi,
} from '@/lib/api-client';
import { useAuthentication } from '@/lib/auth';
import type { RpcDebugOptions, RpcInvokeResponse } from '@/lib/models';
import type {
  RpcDebuggerInvocationResult,
  RpcDebuggerRequestSnapshot,
} from './rpc-debugger-types';

const DEFAULT_ACTION_NAME = 'ping';
const DEFAULT_TIMEOUT_SECONDS = '20';
const DEFAULT_PAYLOAD_TEXT = JSON.stringify(
  { message: 'hello from console' },
  null,
  2,
);

interface ExecuteInvocationInput {
  request: RpcDebuggerRequestSnapshot;
}

function parsePayloadObject(payloadText: string): Record<string, unknown> {
  const parsedPayload: unknown = JSON.parse(payloadText || '{}');
  if (
    typeof parsedPayload !== 'object' ||
    parsedPayload === null ||
    Array.isArray(parsedPayload)
  ) {
    throw new Error('Payload 必须是 JSON 对象');
  }
  return parsedPayload as Record<string, unknown>;
}

function buildRequestPath(
  projectName: string,
  actionName: string,
  clientId: string,
): string {
  const queryString = buildQueryString({ clientId });
  return `/rpc/debug/invoke/${encodeURIComponent(projectName)}/${encodeURIComponent(actionName)}${queryString}`;
}

export function useRpcDebugger() {
  const { can } = useAuthentication();
  const hasManualRpcPermission = can('invoke', 'manual-rpc');
  const [projectSelection, setProjectSelection] = useState('');
  const [actionName, setActionName] = useState(DEFAULT_ACTION_NAME);
  const [clientSelection, setClientSelection] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(
    DEFAULT_TIMEOUT_SECONDS,
  );
  const [payloadText, setPayloadText] = useState(DEFAULT_PAYLOAD_TEXT);
  const [invocationResult, setInvocationResult] =
    useState<RpcDebuggerInvocationResult | null>(null);
  const queryClient = useQueryClient();

  const projectOptionsQuery = useQuery({
    queryKey: ['rpc-debugger', 'options'],
    queryFn: () => requestApi<RpcDebugOptions>('/rpc/debug/options'),
    enabled: hasManualRpcPermission,
  });
  const projects = useMemo(
    () => projectOptionsQuery.data?.projects ?? [],
    [projectOptionsQuery.data],
  );
  const selectedProjectName =
    projects.find((project) => project.name === projectSelection)?.name ??
    projects.find((project) => project.enabled)?.name ??
    projects[0]?.name ??
    '';

  const projectContextQuery = useQuery({
    queryKey: ['rpc-debugger', 'options', selectedProjectName],
    queryFn: () =>
      requestApi<RpcDebugOptions>(
        `/rpc/debug/options${buildQueryString({
          project: selectedProjectName,
        })}`,
      ),
    enabled: hasManualRpcPermission && selectedProjectName.length > 0,
  });
  const clientIds = projectContextQuery.data?.clientIds ?? [];
  const selectedClientId = clientIds.includes(clientSelection)
    ? clientSelection
    : '';
  const actionOptions = projectContextQuery.data?.actions ?? [];
  const selectedProject = projects.find(
    (project) => project.name === selectedProjectName,
  );

  const requestPreview = useMemo(() => {
    let payload: unknown;
    try {
      payload = parsePayloadObject(payloadText);
    } catch {
      payload = payloadText;
    }
    const parsedTimeoutSeconds = Number(timeoutSeconds);
    return {
      method: 'POST',
      url:
        selectedProjectName && actionName.trim()
          ? buildRequestPath(
              selectedProjectName,
              actionName.trim(),
              selectedClientId,
            )
          : '/rpc/debug/invoke/{project}/{action}',
      body: {
        timeoutSeconds: Number.isInteger(parsedTimeoutSeconds)
          ? parsedTimeoutSeconds
          : timeoutSeconds,
        payload,
      },
    };
  }, [
    actionName,
    payloadText,
    selectedClientId,
    selectedProjectName,
    timeoutSeconds,
  ]);

  const invocationMutation = useMutation({
    mutationFn: ({ request }: ExecuteInvocationInput) =>
      requestApi<RpcInvokeResponse>(request.url, {
        method: 'POST',
        body: JSON.stringify(request.body),
      }),
    onSuccess: (response, input) => {
      setInvocationResult({
        request: input.request,
        response,
        transportStatusCode: 200,
        completedAt: new Date().toISOString(),
      });
      if (response.is_ok) {
        toast.success('RPC 调用成功');
        return;
      }
      toast.error('RPC 返回失败状态');
    },
    onError: (error, input) => {
      const errorMessage = getRequestErrorMessage(error, 'RPC 调用失败');
      setInvocationResult({
        request: input.request,
        response: { error: errorMessage },
        transportStatusCode:
          error instanceof ApiRequestError ? error.statusCode : 0,
        completedAt: new Date().toISOString(),
      });
      toast.error(errorMessage);
    },
  });

  function selectProject(projectName: string) {
    setProjectSelection(projectName);
    setClientSelection('');
    setInvocationResult(null);
  }

  function formatPayload() {
    try {
      const payload = parsePayloadObject(payloadText);
      setPayloadText(JSON.stringify(payload, null, 2));
      toast.success('Payload JSON 已格式化');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Payload 格式错误');
    }
  }

  function executeInvocation() {
    const normalizedActionName = actionName.trim();
    const parsedTimeoutSeconds = Number(timeoutSeconds);
    if (!selectedProjectName || !normalizedActionName) {
      toast.error('请选择功能组并填写 Action');
      return;
    }
    if (
      !Number.isInteger(parsedTimeoutSeconds) ||
      parsedTimeoutSeconds < 1
    ) {
      toast.error('超时秒数必须是大于 0 的整数');
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = parsePayloadObject(payloadText);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Payload 格式错误');
      return;
    }
    const request: RpcDebuggerRequestSnapshot = {
      method: 'POST',
      url: buildRequestPath(
        selectedProjectName,
        normalizedActionName,
        selectedClientId,
      ),
      body: { timeoutSeconds: parsedTimeoutSeconds, payload },
    };
    invocationMutation.mutate({ request });
  }

  async function refreshContext() {
    await queryClient.invalidateQueries({ queryKey: ['rpc-debugger'] });
    toast.success('RPC 调试上下文已刷新');
  }

  return {
    projects,
    selectedProject,
    selectedProjectName,
    selectProject,
    actionName,
    setActionName,
    actionOptions,
    clientIds,
    selectedClientId,
    setClientSelection,
    timeoutSeconds,
    setTimeoutSeconds,
    payloadText,
    setPayloadText,
    requestPreview,
    invocationResult,
    isLoading:
      projectOptionsQuery.isLoading || projectContextQuery.isLoading,
    isError: projectOptionsQuery.isError || projectContextQuery.isError,
    isInvoking: invocationMutation.isPending,
    formatPayload,
    executeInvocation,
    refreshContext,
  };
}
