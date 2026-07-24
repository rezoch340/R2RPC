'use client';

import { Fragment, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface RowAction {
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  separatorBefore?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function RowActions({
  actions,
  label = '打开操作菜单',
}: {
  actions: RowAction[];
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={label}>
            <MoreHorizontal />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {actions.map((action, actionIndex) => (
          <Fragment key={action.label}>
            {action.separatorBefore && actionIndex > 0 ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              variant={action.destructive ? 'destructive' : 'default'}
              disabled={action.disabled}
              onClick={action.onSelect}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
