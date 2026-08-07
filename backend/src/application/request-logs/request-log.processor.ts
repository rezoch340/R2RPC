import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { QUEUE } from '../../infrastructure/queue/queue.constants';
import { SearchService } from '../../infrastructure/search/search.service';
import { AccessTokenService } from '../access-token/access-token.service';
import { MetricsService } from '../metrics/metrics.service';
import { buildManticoreDoc } from './request-log.doc';
import { RequestLogJob } from './request-log.types';
import { RequestLogsService } from './request-logs.service';

// 消费请求日志队列:写 PG 脊柱(pending)-> 写 Manticore payload -> indexed。
// 抛错 -> BullMQ 重试;重试耗尽 -> failed 事件里标 failed + 转 dead-letter。
@Processor(QUEUE.REQUEST_LOG)
export class RequestLogProcessor extends WorkerHost {
  private readonly logger = new Logger('RequestLogProcessor');

  constructor(
    private readonly logs: RequestLogsService,
    private readonly search: SearchService,
    private readonly metrics: MetricsService,
    private readonly accessTokens: AccessTokenService,
    @InjectQueue(QUEUE.DEAD_LETTER) private readonly deadLetterQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<RequestLogJob>) {
    const requestLog = job.data;
    const newlyInserted = await this.logs.writeSpine(requestLog, 'pending');
    if (newlyInserted) {
      await this.metrics.recordCompletion(requestLog);
      // 当月调用计数同样靠首插去重;后台手动调试没有 access token,跳过
      if (requestLog.accessTokenId !== null) {
        await this.accessTokens.recordMonthlyUsage(requestLog.accessTokenId);
      }
    }
    await this.search.indexPayload(buildManticoreDoc(requestLog));
    await this.logs.markState(requestLog.requestId, 'indexed');
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<RequestLogJob>) {
    const maximumAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maximumAttempts) {
      return;
    } // 还会重试
    this.logger.warn(`请求日志重试耗尽,转 dead-letter: ${job.data.requestId}`);
    await this.logs
      .markState(job.data.requestId, 'failed')
      .catch(() => undefined);
    await this.deadLetterQueue.add('failed-log', job.data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30000 },
      removeOnComplete: true,
    });
  }
}
