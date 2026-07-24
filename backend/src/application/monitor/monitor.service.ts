import { Injectable } from '@nestjs/common';
import { SearchService } from '../../infrastructure/search/search.service';
import {
  ListFilter,
  RequestLogsService,
} from '../request-logs/request-logs.service';

function safeParse(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value ?? null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function safeParseNullable(value: unknown): unknown {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return safeParse(value);
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

  // 筛选下拉选项:去重 project/action/client(联动过滤 + 实体仍存在)
  requestOptions(filter: {
    project?: string;
    action?: string;
    clientId?: string;
  }) {
    return this.logs.filterOptions(filter);
  }

  // 详情:先查 PG 脊柱,再按 requestId 从 Manticore 懒加载 payload;不可用则标记 payloadUnavailable
  async detail(requestId: string) {
    const logSpine = await this.logs.detailSpine(requestId);
    if (!logSpine) {
      return null;
    }
    const searchDocument = await this.search.getByRequestId(requestId);
    if (!searchDocument) {
      return {
        ...logSpine,
        payloadUnavailable: true,
        requestPayload: null,
        responsePayload: null,
        appAudit: null,
      };
    }
    return {
      ...logSpine,
      payloadUnavailable: false,
      requestPayload: safeParse(searchDocument.request_payload_json),
      responsePayload: safeParse(searchDocument.response_payload_json),
      appAudit: safeParseNullable(searchDocument.app_audit_json),
    };
  }
}
