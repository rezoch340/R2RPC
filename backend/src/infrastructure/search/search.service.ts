import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

// Manticore 客户端(HTTP JSON API,用 node 原生 fetch)。第一职责:存完整 request/response payload 原文。
@Injectable()
export class SearchService {
  constructor(private readonly cfg: ConfigService) {}

  private get base() {
    return this.cfg.manticore.url;
  }

  // 写入完整 payload 文档
  async indexPayload(doc: Record<string, unknown>): Promise<void> {
    await fetch(`${this.base}/insert`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
  }

  // 按 requestId 懒加载原文;Manticore 不可用返回 null(调用方标记 payloadUnavailable)
  async getByRequestId(requestId: string): Promise<unknown | null> {
    try {
      const res = await fetch(`${this.base}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: { equals: { request_id: requestId } } }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}
