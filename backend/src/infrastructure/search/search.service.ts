import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

const TABLE = 'request_logs';

// Manticore 客户端(HTTP JSON API,node 原生 fetch)。第一职责:存完整 request/response payload 原文。
@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger('Search');
  private ready = false;
  constructor(private readonly configuration: ConfigService) {}
  private get base() {
    return this.configuration.manticore.url;
  }

  async onModuleInit() {
    // 启动即尝试建表;失败不阻断启动(indexPayload 时会再建)
    await this.ensureTable().catch((error) =>
      this.logger.warn(
        `Manticore 建表失败(稍后重试): ${(error as Error).message}`,
      ),
    );
  }

  async ensureTable() {
    await this.rawSql(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (request_id string, project_name string, action_name string, client_id string, status string, http_code int, latency_ms int, created_at string, finished_at string, request_payload_json text, response_payload_json text, app_audit_json text, error_message text)`,
    );
    await this.ensureAppAuditColumn();
    this.ready = true;
  }

  // 兼容已有 Manticore 数据卷；搜索索引 schema 由本 service 管理，不属于 PostgreSQL migration。
  private async ensureAppAuditColumn() {
    const hasColumn = async () =>
      /\bapp_audit_json\b/i.test(await this.rawSql(`DESC ${TABLE}`));
    if (await hasColumn()) {
      return;
    }
    try {
      await this.rawSql(`ALTER TABLE ${TABLE} ADD COLUMN app_audit_json text`);
    } catch (error) {
      // 多 API/Worker 并发启动时可能由另一实例先补列；复查后再决定是否抛错。
      if (!(await hasColumn())) {
        throw error;
      }
    }
  }

  // 写入完整 payload 文档;用 request_id 派生的确定性 id 做 upsert(重试幂等)
  async indexPayload(document: Record<string, unknown>): Promise<void> {
    if (!this.ready) {
      await this.ensureTable();
    }
    const response = await fetch(`${this.base}/replace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        index: TABLE,
        id: this.docId(String(document.request_id)),
        doc: document,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Manticore replace ${response.status}: ${await response.text()}`,
      );
    }
  }

  // 按 requestId 懒加载原文;Manticore 不可用 / 未命中返回 null(调用方标记 payloadUnavailable)
  async getByRequestId(
    requestId: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.base}/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          index: TABLE,
          query: { equals: { request_id: requestId } },
          limit: 1,
        }),
      });
      if (!response.ok) {
        return null;
      }
      const searchResult = (await response.json()) as {
        hits?: { hits?: Array<{ _source?: Record<string, unknown> }> };
      };
      return searchResult.hits?.hits?.[0]?._source ?? null;
    } catch {
      return null;
    }
  }

  private async rawSql(query: string): Promise<string> {
    const response = await fetch(`${this.base}/cli`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: query,
    });
    if (!response.ok) {
      throw new Error(`Manticore SQL ${response.status}`);
    }
    return response.text();
  }

  // uuid -> 52 位安全整数 id(用于 /replace 幂等;碰撞概率极低,MVP 可接受)
  private docId(requestId: string): number {
    const hex = requestId.replace(/-/g, '').slice(0, 13);
    return Number.parseInt(hex, 16) || 1;
  }
}
