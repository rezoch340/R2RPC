import {
  ArgumentMetadata,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';

// PostgreSQL serial 主键是 int4,超过上界的值查库会在驱动层抛错变成 500。
// 继承 ParseIntPipe 只补一个上界检查,保持原有的非整数 → 400 行为不变。
export class ParseEntityIdPipe extends ParseIntPipe {
  private static readonly MAXIMUM_ENTITY_ID = 2_147_483_647;

  async transform(value: string, metadata: ArgumentMetadata): Promise<number> {
    const entityId = await super.transform(value, metadata);
    if (entityId > ParseEntityIdPipe.MAXIMUM_ENTITY_ID) {
      throw new BadRequestException('编号超出取值范围');
    }
    return entityId;
  }
}
