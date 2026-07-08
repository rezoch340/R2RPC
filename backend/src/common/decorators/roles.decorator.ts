import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
// 标注接口所需角色(RBAC)
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
