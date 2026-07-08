// 请求日志队列任务体(热路径入队 / worker 消费 / 降级同步写共用)
export interface RequestLogJob {
  requestId: string;
  group: string;
  action: string;
  clientId: string | null;
  requesterUserId: number | string | null;
  status: string;
  httpCode: number;
  latencyMs: number;
  error: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  createdAt: string;
  finishedAt: string;
}
