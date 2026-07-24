import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { alive } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { users } from './users.schema';

export interface AdministratorMutationTarget {
  id: number;
  isRoot: boolean;
}

export function assertAdministratorMutationAllowed(
  requesterUserId: number,
  targetUser: AdministratorMutationTarget,
): void {
  if (targetUser.isRoot && targetUser.id !== requesterUserId) {
    throw new ForbiddenException('管理员账号只能由本人修改');
  }
}

@Injectable()
export class AdministratorAccountPolicyService {
  constructor(private readonly dbService: DbService) {}

  async assertCanMutateUser(
    requesterUserId: number,
    targetUserId: number,
  ): Promise<void> {
    const [targetUser] = await this.dbService.database
      .select({ id: users.id, isRoot: users.isRoot })
      .from(users)
      .where(alive(users, eq(users.id, targetUserId)))
      .limit(1);
    if (!targetUser) {
      throw new NotFoundException('用户不存在');
    }
    assertAdministratorMutationAllowed(requesterUserId, targetUser);
  }
}
