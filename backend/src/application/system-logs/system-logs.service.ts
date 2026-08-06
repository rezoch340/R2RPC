import { Injectable } from '@nestjs/common';
import { and, desc, SQL } from 'drizzle-orm';
import {
  compactConditions,
  eqIf,
  gteIf,
  lteIf,
} from '../../common/db/filter-conditions';
import { paginate } from '../../common/db/paginate';
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
    return paginate(
      this.database,
      systemLogs,
      whereClause,
      query,
      (limit, offset) =>
        this.database
          .select()
          .from(systemLogs)
          .where(whereClause)
          .orderBy(desc(systemLogs.createdAt), desc(systemLogs.id))
          .limit(limit)
          .offset(offset),
    );
  }

  private buildConditions(query: QuerySystemLogsDto): SQL[] {
    return compactConditions(
      eqIf(systemLogs.name, query.name),
      eqIf(systemLogs.actorUsername, query.actorUsername),
      eqIf(systemLogs.action, query.action),
      eqIf(systemLogs.subject, query.subject),
      eqIf(systemLogs.targetType, query.targetType),
      eqIf(systemLogs.targetName, query.targetName),
      eqIf(systemLogs.status, query.status),
      gteIf(systemLogs.createdAt, query.from),
      lteIf(systemLogs.createdAt, query.to),
    );
  }
}
