import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, SQL, sql } from 'drizzle-orm';
import { pageBounds } from '../../common/db/page-bounds';
import { DbService } from '../../infrastructure/db/db.service';
import { QuerySystemLogsDto } from './dto/query-system-logs.dto';
import { CreateSystemLogInput } from './entity/model';
import { systemLogs } from './system-logs.schema';

@Injectable()
export class SystemLogsService {
  constructor(private readonly dbService: DbService) {}

  private get database() {
    return this.dbService.database;
  }

  async create(input: CreateSystemLogInput): Promise<void> {
    await this.database.insert(systemLogs).values(input);
  }

  async list(query: QuerySystemLogsDto) {
    const conditions = this.buildConditions(query);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const { page, pageSize, offset } = pageBounds(query);
    const rows = await this.database
      .select()
      .from(systemLogs)
      .where(whereClause)
      .orderBy(desc(systemLogs.createdAt), desc(systemLogs.id))
      .limit(pageSize)
      .offset(offset);
    const [{ total }] = await this.database
      .select({ total: sql<number>`count(*)::int` })
      .from(systemLogs)
      .where(whereClause);
    return { rows, page, pageSize, total };
  }

  private buildConditions(query: QuerySystemLogsDto): SQL[] {
    const conditions: SQL[] = [];
    if (query.name) {
      conditions.push(eq(systemLogs.name, query.name));
    }
    if (query.actorUsername) {
      conditions.push(eq(systemLogs.actorUsername, query.actorUsername));
    }
    if (query.action) {
      conditions.push(eq(systemLogs.action, query.action));
    }
    if (query.subject) {
      conditions.push(eq(systemLogs.subject, query.subject));
    }
    if (query.targetType) {
      conditions.push(eq(systemLogs.targetType, query.targetType));
    }
    if (query.targetName) {
      conditions.push(eq(systemLogs.targetName, query.targetName));
    }
    if (query.status) {
      conditions.push(eq(systemLogs.status, query.status));
    }
    if (query.from) {
      conditions.push(gte(systemLogs.createdAt, new Date(query.from)));
    }
    if (query.to) {
      conditions.push(lte(systemLogs.createdAt, new Date(query.to)));
    }
    return conditions;
  }
}
