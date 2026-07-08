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
  group: string;
  action: string;
  payload: unknown;
  timeoutSeconds: number;
}

export interface ResultMessage {
  type: 'result';
  requestId: string;
  clientId: string;
  status: string;
  is_ok: boolean;
  payload?: unknown;
  error?: string;
}

export interface WsMessage {
  type: WsMessageType;
  [key: string]: unknown;
}
