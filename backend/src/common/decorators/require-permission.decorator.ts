import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'required-permission';

// 单个接口所需的权限:action(动作)+ subject(资源)
export interface RequiredPermission {
  action: string;
  subject: string;
}

// 标注接口所需权限,由 PermissionGuard 读取校验;未标注的非 @Public 接口一律 fail-closed 拒绝
export const RequirePermission = (action: string, subject: string) =>
  SetMetadata(PERMISSION_KEY, { action, subject });
