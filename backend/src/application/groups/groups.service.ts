import { ConflictException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../../infrastructure/db/db.service';
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
}
