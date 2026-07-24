'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Blocks,
  Cpu,
  FileClock,
  FolderKanban,
  KeyRound,
  LogOut,
  KeySquare,
  LoaderCircle,
  Menu,
  RadioTower,
  ScrollText,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { AccountPasswordDialog } from '@/components/account-password-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAuthentication } from '@/lib/auth';
import { prefetchNavigationDestination } from '@/lib/navigation-prefetch';
import { combineClassNames } from '@/lib/utils';

interface NavigationItem {
  href: string;
  label: string;
  icon: typeof Activity;
  permission?: {
    action: string;
    subject: string;
  };
}

const NAVIGATION_GROUPS: Array<{
  label: string;
  items: NavigationItem[];
}> = [
  {
    label: '运行态',
    items: [
      { href: '/', label: '运行概览', icon: Activity },
      {
        href: '/projects',
        label: '功能组',
        icon: FolderKanban,
        permission: { action: 'read', subject: 'project' },
      },
      {
        href: '/devices',
        label: '设备',
        icon: Cpu,
        permission: { action: 'read', subject: 'device' },
      },
      {
        href: '/request-logs',
        label: '请求日志',
        icon: ScrollText,
        permission: { action: 'read', subject: 'monitor' },
      },
    ],
  },
  {
    label: '访问控制',
    items: [
      {
        href: '/device-tokens',
        label: '设备令牌',
        icon: RadioTower,
        permission: { action: 'manage', subject: 'device-token' },
      },
      {
        href: '/access-tokens',
        label: '访问令牌',
        icon: KeyRound,
        permission: { action: 'manage', subject: 'access-token' },
      },
      {
        href: '/users',
        label: '后台账号',
        icon: Users,
        permission: { action: 'read', subject: 'user' },
      },
      {
        href: '/permission-groups',
        label: '权限组',
        icon: ShieldCheck,
        permission: { action: 'read', subject: 'rbac' },
      },
    ],
  },
  {
    label: '审计',
    items: [
      {
        href: '/system-logs',
        label: '系统日志',
        icon: FileClock,
        permission: { action: 'read', subject: 'system-log' },
      },
    ],
  },
];

function Brand() {
  return (
    <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-300/20">
        <Blocks className="size-5" />
        <span className="signal-pulse absolute -right-0.5 -top-0.5 size-2 rounded-full bg-cyan-300" />
      </span>
      <div>
        <p className="font-heading text-sm font-semibold tracking-[0.16em] text-white">
          RER0RPC
        </p>
        <p className="font-mono text-[9px] tracking-[0.18em] text-sidebar-foreground uppercase">
          Relay Console
        </p>
      </div>
    </div>
  );
}

function Navigation({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useAuthentication();
  const [pendingDestination, setPendingDestination] = useState<
    string | null
  >(null);

  async function navigate(destination: string) {
    if (pendingDestination !== null) {
      return;
    }
    if (destination === pathname) {
      onNavigate?.();
      return;
    }
    setPendingDestination(destination);
    await prefetchNavigationDestination({
      destination,
      queryClient,
      can,
    });
    router.push(destination);
    onNavigate?.();
    setPendingDestination(null);
  }

  return (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
      {NAVIGATION_GROUPS.map((navigationGroup) => {
        const visibleItems = navigationGroup.items.filter(
          (navigationItem) =>
            !navigationItem.permission ||
            can(
              navigationItem.permission.action,
              navigationItem.permission.subject,
            ),
        );
        if (visibleItems.length === 0) {
          return null;
        }
        return (
          <section key={navigationGroup.label} className="space-y-1">
            <p className="px-3 pb-1 font-mono text-[9px] font-semibold tracking-[0.18em] text-sidebar-foreground/55 uppercase">
              {navigationGroup.label}
            </p>
            {visibleItems.map((navigationItem) => {
              const isActive =
                navigationItem.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(navigationItem.href);
              const NavigationIcon = navigationItem.icon;
              return (
                <Link
                  key={navigationItem.href}
                  href={navigationItem.href}
                  prefetch
                  onNavigate={(navigationEvent) => {
                    navigationEvent.preventDefault();
                    void navigate(navigationItem.href);
                  }}
                  className={combineClassNames(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground',
                  )}
                >
                  <NavigationIcon className="size-4" />
                  {navigationItem.label}
                  {pendingDestination === navigationItem.href ? (
                    <LoaderCircle className="ml-auto size-3.5 animate-spin" />
                  ) : null}
                </Link>
              );
            })}
          </section>
        );
      })}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const { user, logout, isRoot, can } = useAuthentication();
  return (
    <div className="grid h-svh overflow-hidden lg:grid-cols-[230px_1fr]">
      <aside className="hidden flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <Brand />
        <Navigation />
      </aside>

      <Sheet
        open={isMobileNavigationOpen}
        onOpenChange={setIsMobileNavigationOpen}
      >
        <SheetContent
          side="left"
          showCloseButton
          className="gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetTitle className="sr-only">主导航</SheetTitle>
          <SheetDescription className="sr-only">
            RER0RPC 控制台页面导航
          </SheetDescription>
          <Brand />
          <Navigation onNavigate={() => setIsMobileNavigationOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="打开导航"
            onClick={() => setIsMobileNavigationOpen(true)}
          >
            <Menu />
          </Button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <RadioTower className="size-3.5 text-primary" />
            <span>设备 RPC 中继控制面</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" className="h-9 gap-2 px-2.5">
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserRound className="size-3.5" />
                  </span>
                  <span className="font-mono text-xs">{user?.username}</span>
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem disabled>
                {isRoot ? '种子管理员' : '后台账号'}
              </DropdownMenuItem>
              {can('update', 'user') ? (
                <DropdownMenuItem
                  onClick={() => setIsPasswordDialogOpen(true)}
                >
                  <KeySquare />
                  修改我的密码
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={logout}>
                <LogOut />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
            {children}
          </div>
        </main>
      </div>
      <AccountPasswordDialog
        key={`account-password-${isPasswordDialogOpen}`}
        open={isPasswordDialogOpen}
        userId={user?.id}
        onClose={() => setIsPasswordDialogOpen(false)}
      />
    </div>
  );
}
