import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { alive, softDelete } from '../../common/db/soft-delete';
import { hashPassword } from '../../common/utils/password';
import { DbService } from '../../infrastructure/db/db.service';
import { users } from './users.schema';

@Injectable()
export class UsersService {
  constructor(private readonly dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  // 按用户名查(供登录鉴权)
  async findByUsername(username: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(alive(users, eq(users.username, username)))
      .limit(1);
    return row ?? null;
  }

  async list() {
    return this.db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(alive(users));
  }

  async findById(id: number) {
    const [row] = await this.db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(alive(users, eq(users.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException('用户不存在');
    return row;
  }

  async create(input: { username: string; password: string; role?: string }) {
    if (await this.findByUsername(input.username)) {
      throw new ConflictException('用户名已存在');
    }
    const [row] = await this.db
      .insert(users)
      .values({
        username: input.username,
        passwordHash: hashPassword(input.password),
        role: input.role ?? 'admin',
      })
      .returning({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
      });
    return row;
  }

  async remove(id: number) {
    await softDelete(this.db, users, eq(users.id, id));
    return { deleted: true };
  }
}
