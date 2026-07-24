'use client';

import { Braces, LoaderCircle, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { RpcDebugProject } from '@/lib/models';

export function RpcDebuggerForm({
  projects,
  selectedProjectName,
  onProjectChange,
  actionName,
  actionOptions,
  onActionChange,
  clientIds,
  selectedClientId,
  onClientChange,
  timeoutSeconds,
  onTimeoutChange,
  payloadText,
  onPayloadChange,
  isLoading,
  isInvoking,
  onFormatPayload,
  onRefreshContext,
  onInvoke,
}: {
  projects: RpcDebugProject[];
  selectedProjectName: string;
  onProjectChange: (projectName: string) => void;
  actionName: string;
  actionOptions: string[];
  onActionChange: (actionName: string) => void;
  clientIds: string[];
  selectedClientId: string;
  onClientChange: (clientId: string) => void;
  timeoutSeconds: string;
  onTimeoutChange: (timeoutSeconds: string) => void;
  payloadText: string;
  onPayloadChange: (payloadText: string) => void;
  isLoading: boolean;
  isInvoking: boolean;
  onFormatPayload: () => void;
  onRefreshContext: () => Promise<void>;
  onInvoke: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>调用参数</CardTitle>
        <CardDescription>
          功能组和在线设备来自实时上下文；Action 可使用历史值或直接输入。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            onInvoke();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rpc-debug-project">功能组</Label>
              <Select
                value={selectedProjectName || null}
                onValueChange={(selectedValue) =>
                  onProjectChange(String(selectedValue ?? ''))
                }
              >
                <SelectTrigger
                  id="rpc-debug-project"
                  className="w-full"
                  aria-label="功能组"
                >
                  <SelectValue placeholder="请选择功能组" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.name}>
                      {project.name}
                      {project.enabled ? '' : '（已停用）'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rpc-debug-client">目标设备</Label>
              <Select
                value={selectedClientId || null}
                onValueChange={(selectedValue) =>
                  onClientChange(String(selectedValue ?? ''))
                }
              >
                <SelectTrigger
                  id="rpc-debug-client"
                  className="w-full"
                  aria-label="目标设备"
                >
                  <SelectValue placeholder="自动路由" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>自动路由</SelectItem>
                  {clientIds.map((clientId) => (
                    <SelectItem key={clientId} value={clientId}>
                      {clientId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                当前功能组在线设备 {clientIds.length} 台
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rpc-debug-action">Action</Label>
              <Input
                id="rpc-debug-action"
                list="rpc-debug-action-options"
                value={actionName}
                maxLength={128}
                placeholder="ping"
                onChange={(changeEvent) =>
                  onActionChange(changeEvent.target.value)
                }
              />
              <datalist id="rpc-debug-action-options">
                {actionOptions.map((actionOption) => (
                  <option key={actionOption} value={actionOption} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rpc-debug-timeout">超时秒数</Label>
              <Input
                id="rpc-debug-timeout"
                type="number"
                min={1}
                step={1}
                value={timeoutSeconds}
                onChange={(changeEvent) =>
                  onTimeoutChange(changeEvent.target.value)
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="rpc-debug-payload">Payload JSON</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onFormatPayload}
              >
                <Braces />
                格式化
              </Button>
            </div>
            <Textarea
              id="rpc-debug-payload"
              value={payloadText}
              className="min-h-64 font-mono text-xs leading-6"
              spellCheck={false}
              onChange={(changeEvent) =>
                onPayloadChange(changeEvent.target.value)
              }
            />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className={isInvoking ? 'disabled:opacity-100' : undefined}
              disabled={isLoading || isInvoking}
              onClick={() => void onRefreshContext()}
            >
              <RefreshCw className={isLoading ? 'animate-spin' : ''} />
              刷新上下文
            </Button>
            <Button
              type="submit"
              className={isInvoking ? 'disabled:opacity-100' : undefined}
              disabled={
                isLoading ||
                isInvoking ||
                !selectedProjectName ||
                !actionName.trim()
              }
              aria-busy={isInvoking}
            >
              {isInvoking ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Play />
              )}
              发起调用
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
