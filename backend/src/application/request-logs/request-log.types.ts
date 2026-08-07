import type { AppAudit } from '../../common/app-audit/app-audit.types';

// 请求日志队列任务体(热路径入队 / worker 消费 / 降级同步写共用)
export interface RequestLogJob {
  requestId: string;
  project: string;
  action: string;
  clientId: string | null;
  // 调用方自带的业务单号,可空;与内部 requestId 无关
  clientRequestId: string | null;
  requesterUserId: number | string | null;
  // 3.4 起 invoke 调用方是 access token,记录 token id(用户态调用暂无,留 null)
  accessTokenId: number | null;
  status: string;
  httpCode: number;
  latencyMs: number;
  error: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  appAudit: AppAudit | null;
  createdAt: string;
  finishedAt: string;
}
