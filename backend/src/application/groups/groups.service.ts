import { ConflictException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
import { clientGroups } from '../client/client-groups.schema';
import { groups } from './groups.schema';

@Injectable()
export class GroupsService {
  constructor(private readonly dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  async list() {
    return this.db.select().from(groups);
  }

  async findByName(name: string) {
    const [row] = await this.db
      .select()
      .from(groups)
      .where(eq(groups.name, name))
      .limit(1);
    return row ?? null;
  }

  async create(name: string) {
    if (await this.findByName(name)) {
      throw new ConflictException('分组已存在');
    }
    const [row] = await this.db.insert(groups).values({ name }).returning();
    return row;
  }

  async remove(id: number) {
    await this.db.delete(groups).where(eq(groups.id, id));
    return { deleted: true };
  }

  // 按组名查 id(不存在返回 null),供设备登录/建组解析组名用
  async idByName(name: string) {
    const [g] = await this.db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.name, name))
      .limit(1);
    return g?.id ?? null;
  }

  // 查设备所属的所有组(id + name),供设备登录签发多组 JWT 用
  async groupsOfClient(clientDbId: number) {
    return this.db
      .select({ id: groups.id, name: groups.name })
      .from(clientGroups)
      .innerJoin(groups, eq(clientGroups.groupId, groups.id))
      .where(eq(clientGroups.clientId, clientDbId));
  }
}
