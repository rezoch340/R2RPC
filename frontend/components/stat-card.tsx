import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-border">
      <CardContent className="flex items-start justify-between p-5">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="font-heading text-3xl font-semibold tracking-tight">
            {value}
          </p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <span className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}
