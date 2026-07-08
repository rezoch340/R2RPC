import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE } from './queue.constants';

// 队列入口:热路径只入队,冷路径由 worker 消费
@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(QUEUE.REQUEST_LOG) private readonly requestLog: Queue,
  ) {}

  // 入队一条请求日志任务(脊柱 + payload 文档由 worker 落库);失败重试 3 次,耗尽转 dead-letter
  enqueueRequestLog(data: object) {
    return this.requestLog.add('log', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
