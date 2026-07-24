import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { alive, softDelete } from '../../common/db/soft-delete';
import { hashPassword } from '../../common/utils/password';
import { DbService } from '../../infrastructure/db/db.service';
import { AdministratorAccountPolicyService } from './administrator-account-policy.service';
import { users } from './users.schema';

const publicUserSelection = {
  id: users.id,
  username: users.username,
  role: users.role,
  isRoot: users.isRoot,
  enabled: users.enabled,
  description: users.description,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

@Injectable()
export class UsersService {
  constructor(
    private readonly dbService: DbService,
    private readonly administratorAccountPolicyService: AdministratorAccountPolicyService,
  ) {}

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
      .select(publicUserSelection)
      .from(users)
      .where(alive(users));
  }

  async findById(userId: number) {
    const [userRecord] = await this.database
      .select(publicUserSelection)
      .from(users)
      .where(alive(users, eq(users.id, userId)))
      .limit(1);
    if (!userRecord) {
      throw new NotFoundException('用户不存在');
    }
    return userRecord;
  }

  async create(input: {
    username: string;
    password: string;
    role?: string;
    description?: string;
  }) {
    if (await this.findByUsername(input.username)) {
      throw new ConflictException('用户名已存在');
    }
    const [createdUser] = await this.database
      .insert(users)
      .values({
        username: input.username,
        passwordHash: hashPassword(input.password),
        role: input.role ?? 'admin',
        description: input.description,
      })
      .returning(publicUserSelection);
    return createdUser;
  }

  async update(
    requesterUserId: number,
    targetUserId: number,
    description: string,
  ) {
    await this.administratorAccountPolicyService.assertCanMutateUser(
      requesterUserId,
      targetUserId,
    );
    const [updatedUser] = await this.database
      .update(users)
      .set({ description })
      .where(alive(users, eq(users.id, targetUserId)))
      .returning(publicUserSelection);
    if (!updatedUser) {
      throw new NotFoundException('用户不存在');
    }
    return updatedUser;
  }

  async setPassword(
    requesterUserId: number,
    targetUserId: number,
    password: string,
  ) {
    await this.administratorAccountPolicyService.assertCanMutateUser(
      requesterUserId,
      targetUserId,
    );
    const [updatedUser] = await this.database
      .update(users)
      .set({ passwordHash: hashPassword(password) })
      .where(alive(users, eq(users.id, targetUserId)))
      .returning(publicUserSelection);
    if (!updatedUser) {
      throw new NotFoundException('用户不存在');
    }
    return updatedUser;
  }

  async remove(requesterUserId: number, targetUserId: number) {
    await this.administratorAccountPolicyService.assertCanMutateUser(
      requesterUserId,
      targetUserId,
    );
    const [deletedUser] = await softDelete(
      this.database,
      users,
      eq(users.id, targetUserId),
    );
    if (!deletedUser) {
      throw new NotFoundException('用户不存在');
    }
    return { deleted: true };
  }

  async updateLastLogin(userId: number) {
    await this.database
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, userId));
  }

  async setEnabled(
    requesterUserId: number,
    targetUserId: number,
    enabled: boolean,
  ) {
    await this.administratorAccountPolicyService.assertCanMutateUser(
      requesterUserId,
      targetUserId,
    );
    const [updatedUser] = await this.database
      .update(users)
      .set({ enabled })
      .where(alive(users, eq(users.id, targetUserId)))
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
