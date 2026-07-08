import { Injectable } from '@nestjs/common';
import { SearchService } from '../../infrastructure/search/search.service';
import {
  ListFilter,
  RequestLogsService,
} from '../request-logs/request-logs.service';

function safeParse(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}

@Injectable()
export class MonitorService {
  constructor(
    private readonly logs: RequestLogsService,
    private readonly search: SearchService,
  ) {}

  // 列表:查 PG 脊柱,不返 payload
  list(filter: ListFilter) {
    return this.logs.list(filter);
  }

  // 详情:先查 PG 脊柱,再按 requestId 从 Manticore 懒加载 payload;不可用则标记 payloadUnavailable
  async detail(requestId: string) {
    const spine = await this.logs.detailSpine(requestId);
    if (!spine) return null;
    const doc = await this.search.getByRequestId(requestId);
    if (!doc) {
      return {
        ...spine,
        payloadUnavailable: true,
        requestPayload: null,
        responsePayload: null,
      };
    }
    return {
      ...spine,
      payloadUnavailable: false,
      requestPayload: safeParse(doc.request_payload_json),
      responsePayload: safeParse(doc.response_payload_json),
    };
  }
}
