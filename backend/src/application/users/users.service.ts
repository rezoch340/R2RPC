import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { users } from './users.schema';

@Injectable()
export class UsersService {
  constructor(private readonly dbService: DbService) {}

  // 按用户名查(供登录鉴权)
  async findByUsername(username: string) {
    const [row] = await this.dbService.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return row ?? null;
  }
}
