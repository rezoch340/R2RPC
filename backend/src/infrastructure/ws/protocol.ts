import type { AppAudit } from '../../common/app-audit/app-audit.types';

// 手机端 WebSocket 协议消息类型(与旧协议兼容)
export type WsMessageType =
  | 'welcome'
  | 'job'
  | 'heartbeat'
  | 'heartbeatAck'
  | 'result'
  | 'resultAck'
  | 'error';

export interface JobMessage {
  type: 'job';
  requestId: string;
  project: string;
  action: string;
  payload: unknown;
  timeoutSeconds: number;
  deadlineAt?: number; // epoch ms,过期任务派发前丢弃;0/缺省=无截止
}

export interface ResultMessage {
  type: 'result';
  requestId: string;
  clientId: string;
  status: string;
  is_ok: boolean;
  httpCode?: number;
  payload?: unknown;
  error?: string;
  // 设备内部执行 Step 的最终快照；服务端校验后只进入请求日志，不透传给 invoke 调用方
  appAudit?: AppAudit;
}

export interface WsMessage {
  type: WsMessageType;
  [key: string]: unknown;
}
