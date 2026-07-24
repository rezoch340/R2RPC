import { Badge } from '@/components/ui/badge';

const STATUS_LABELS: Record<string, string> = {
  active: '有效',
  revoked: '已撤销',
  online: '在线',
  offline: '离线',
  stale: '失联',
  disabled: '已停用',
  no_device: '无设备',
  ok: '成功',
  timeout: '超时',
  failed: '失败',
  succeeded: '成功',
  pending: '待索引',
  indexed: '已索引',
  unavailable: '不可用',
};

export function StatusBadge({ status }: { status: string }) {
  const successful = ['active', 'online', 'ok', 'succeeded', 'indexed'].includes(
    status,
  );
  const dangerous = ['failed', 'revoked', 'disabled', 'unavailable'].includes(
    status,
  );
  const badgeVariant = dangerous
    ? 'destructive'
    : successful
      ? 'default'
      : 'secondary';
  return (
    <Badge variant={badgeVariant}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
