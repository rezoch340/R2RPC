export type SystemLogStatus = 'succeeded' | 'failed';

export interface CreateSystemLogInput {
  name: string;
  description: string;
  actorUserId: number;
  actorUsername: string;
  action: string;
  subject: string;
  targetType: string;
  targetId: string | null;
  targetName: string | null;
  metadata: Record<string, unknown>;
  method: string;
  route: string;
  status: SystemLogStatus;
  statusCode: number;
  errorMessage: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}
