// BullMQ 队列名(冷路径异步任务)
export const QUEUE = {
  REQUEST_LOG: 'request-log',
  METRICS: 'metrics',
  MAINTENANCE: 'maintenance',
  DEAD_LETTER: 'dead-letter',
} as const;
