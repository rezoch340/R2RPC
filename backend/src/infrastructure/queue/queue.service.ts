import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE } from './queue.constants';

// 队列入口:热路径只入队,冷路径由 worker 消费
@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE.REQUEST_LOG) private readonly requestLog: Queue,
  ) {}

  // 入队一条请求日志任务(脊柱 + payload 文档由 worker 落库)
  enqueueRequestLog(data: Record<string, unknown>) {
    return this.requestLog.add('log', data);
  }
}
