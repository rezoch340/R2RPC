import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service';

// PostgreSQL 连接 + Drizzle 客户端。database 是权威数据源。
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool;
  readonly database: NodePgDatabase;

  constructor(configuration: ConfigService) {
    this.pool = new Pool({
      host: configuration.db.host,
      port: configuration.db.port,
      user: configuration.db.user,
      password: configuration.db.password,
      database: configuration.db.database,
    });
    this.database = drizzle(this.pool);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
