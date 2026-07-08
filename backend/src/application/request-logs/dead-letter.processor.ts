import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE } from '../../infrastructure/queue/queue.constants';
import { SearchService } from '../../infrastructure/search/search.service';
import { buildManticoreDoc } from './request-log.doc';
import { RequestLogJob } from './request-log.types';
import { RequestLogsService } from './request-logs.service';

// 死信补偿:重试补写 Manticore payload(死信任务里带完整 payload),成功则回填 indexed。
@Processor(QUEUE.DEAD_LETTER)
export class DeadLetterProcessor extends WorkerHost {
  private readonly logger = new Logger('DeadLetterProcessor');

  constructor(
    private readonly logs: RequestLogsService,
    private readonly search: SearchService,
  ) {
    super();
  }

  async process(job: Job<RequestLogJob>) {
    await this.logs.writeSpine(job.data, 'failed'); // 脊柱兜底(通常已存在)
    await this.search.indexPayload(buildManticoreDoc(job.data));
    await this.logs.markState(job.data.requestId, 'indexed');
    this.logger.log(`死信补写成功: ${job.data.requestId}`);
  }
}
