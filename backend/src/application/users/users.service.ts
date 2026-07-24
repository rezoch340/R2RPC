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
  private get database() {
    return this.dbService.database;
  }

  // 按用户名查(供登录鉴权)
  async findByUsername(username: string) {
    const [userRecord] = await this.database
      .select()
      .from(users)
      .where(alive(users, eq(users.username, username)))
      .limit(1);
    return userRecord ?? null;
  }

  async list() {
    return this.database
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
        enabled: users.enabled,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(alive(users));
  }

  async findById(userId: number) {
    const [userRecord] = await this.database
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        createdAt: users.createdAt,
        enabled: users.enabled,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(alive(users, eq(users.id, userId)))
      .limit(1);
    if (!userRecord) {
      throw new NotFoundException('用户不存在');
    }
    return userRecord;
  }

  async create(input: { username: string; password: string; role?: string }) {
    if (await this.findByUsername(input.username)) {
      throw new ConflictException('用户名已存在');
    }
    const [createdUser] = await this.database
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
    return createdUser;
  }

  async remove(userId: number) {
    await softDelete(this.database, users, eq(users.id, userId));
    return { deleted: true };
  }

  async updateLastLogin(userId: number) {
    await this.database
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId));
  }

  async setEnabled(userId: number, enabled: boolean) {
    const [updatedUser] = await this.database
      .update(users)
      .set({ enabled })
      .where(alive(users, eq(users.id, userId)))
      .returning({
        id: users.id,
        username: users.username,
        enabled: users.enabled,
      });
    if (!updatedUser) {
      throw new NotFoundException('用户不存在');
    }
    return updatedUser;
  }
}
