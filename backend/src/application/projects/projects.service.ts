import { ConflictException, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { alive, softDelete } from '../../common/db/soft-delete';
import { DbService } from '../../infrastructure/db/db.service';
import { projects } from './projects.schema';

@Injectable()
export class ProjectsService {
  constructor(private readonly dbService: DbService) {}
  private get db() {
    return this.dbService.db;
  }

  async list() {
    return this.db.select().from(projects).where(alive(projects));
  }

  async findByName(name: string) {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return row ?? null;
  }

  async create(name: string) {
    if (await this.findByName(name)) {
      throw new ConflictException('功能组已存在');
    }
    const [row] = await this.db.insert(projects).values({ name }).returning();
    return row;
  }

  async remove(id: number) {
    await softDelete(this.db, projects, eq(projects.id, id));
    return { deleted: true };
  }

  // 按名查 id(不存在返回 null),供设备登录/建组解析 project 名用
  async idByName(name: string) {
    const [g] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(alive(projects, eq(projects.name, name)))
      .limit(1);
    return g?.id ?? null;
  }
}
