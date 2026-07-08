import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';

// 全局 DB 模块,任何模块都能注入 DbService
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
