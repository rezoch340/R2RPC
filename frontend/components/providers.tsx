'use client';

import { useState, type ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { AuthenticationProvider } from '@/lib/auth';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            refetchOnMount: 'always',
            refetchOnReconnect: 'always',
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthenticationProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </AuthenticationProvider>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
