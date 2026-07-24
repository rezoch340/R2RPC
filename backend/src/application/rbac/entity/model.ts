// RBAC 领域模型。JwtStrategy / PermissionGuard(Task 2.3)直接消费这两个类型,形状需保持一致。

// 单条权限:action(动作)+ subject(资源)
export interface PermissionTuple {
  action: string;
  subject: string;
}

// 鉴权通过后挂在 request 上的用户身份:权限列表 + 是否 root(root 直通,不受权限约束)
export interface AuthenticatedUser {
  id: number;
  permissions: PermissionTuple[];
  isRoot: boolean;
}

export interface PermissionGroupPermission {
  id: number;
  action: string;
  subject: string;
  description: string | null;
}

export interface PermissionGroup {
  id: number;
  name: string;
  description: string | null;
  createdAt: Date;
  permissions: PermissionGroupPermission[];
}
