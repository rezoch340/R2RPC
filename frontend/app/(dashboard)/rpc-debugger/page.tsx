'use client';

import { Activity, FolderKanban, RadioTower, Route } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { PermissionBoundary } from '@/components/permission-boundary';
import { QueryErrorState } from '@/components/query-state';
import { StatCard } from '@/components/stat-card';
import { RpcDebuggerForm } from './rpc-debugger-form';
import { RpcDebuggerResult } from './rpc-debugger-result';
import { useRpcDebugger } from './use-rpc-debugger';

export default function RpcDebuggerPage() {
  const rpcDebugger = useRpcDebugger();
  return (
    <PermissionBoundary action="invoke" subject="manual-rpc">
      <PageHeader
        eyebrow="Manual invocation"
        title="手动 RPC 调试"
        description="通过后台权限选择功能组、Action 和在线设备，直接验证真实 RPC 派发链路。"
      />
      {rpcDebugger.isError ? (
        <QueryErrorState message="RPC 调试上下文加载失败，请确认权限和服务状态" />
      ) : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="功能组"
          value={rpcDebugger.selectedProjectName || '未选择'}
          hint={
            rpcDebugger.selectedProject?.enabled ? '已启用' : '未启用或不存在'
          }
          icon={FolderKanban}
        />
        <StatCard
          label="在线设备"
          value={String(rpcDebugger.clientIds.length)}
          hint="当前功能组可路由设备"
          icon={RadioTower}
        />
        <StatCard
          label="Action"
          value={rpcDebugger.actionName || '未填写'}
          hint={
            rpcDebugger.actionOptions.includes(rpcDebugger.actionName)
              ? '历史 Action'
              : '手动输入'
          }
          icon={Activity}
        />
        <StatCard
          label="路由"
          value={rpcDebugger.selectedClientId || '自动路由'}
          hint={
            rpcDebugger.selectedClientId ? '指定在线设备' : '服务端轮询选择'
          }
          icon={Route}
        />
      </section>
      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]">
        <RpcDebuggerForm
          projects={rpcDebugger.projects}
          selectedProjectName={rpcDebugger.selectedProjectName}
          onProjectChange={rpcDebugger.selectProject}
          actionName={rpcDebugger.actionName}
          actionOptions={rpcDebugger.actionOptions}
          onActionChange={rpcDebugger.setActionName}
          clientIds={rpcDebugger.clientIds}
          selectedClientId={rpcDebugger.selectedClientId}
          onClientChange={rpcDebugger.setClientSelection}
          timeoutSeconds={rpcDebugger.timeoutSeconds}
          onTimeoutChange={rpcDebugger.setTimeoutSeconds}
          payloadText={rpcDebugger.payloadText}
          onPayloadChange={rpcDebugger.setPayloadText}
          isLoading={rpcDebugger.isLoading}
          isInvoking={rpcDebugger.isInvoking}
          onFormatPayload={rpcDebugger.formatPayload}
          onRefreshContext={rpcDebugger.refreshContext}
          onInvoke={rpcDebugger.executeInvocation}
        />
        <RpcDebuggerResult
          requestPreview={rpcDebugger.requestPreview}
          invocationResult={rpcDebugger.invocationResult}
          isInvoking={rpcDebugger.isInvoking}
        />
      </section>
    </PermissionBoundary>
  );
}
