'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { requestApi, tokenStorage } from '@/lib/api-client';
import type { AuthenticatedUser } from '@/lib/models';
import { Skeleton } from '@/components/ui/skeleton';

interface AuthenticationContextValue {
  user: AuthenticatedUser | null;
  isRoot: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (action: string, subject: string) => boolean;
}

const AuthenticationContext =
  createContext<AuthenticationContextValue | null>(null);

async function loadAuthenticatedUser(): Promise<AuthenticatedUser> {
  return requestApi<AuthenticatedUser>('/auth/me');
}

export function AuthenticationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tokenStorage.read()) {
      queueMicrotask(() => setIsLoading(false));
      return;
    }
    loadAuthenticatedUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const contextValue = useMemo<AuthenticationContextValue>(
    () => ({
      user,
      isRoot: user?.isRoot ?? false,
      async login(username: string, password: string) {
        const loginResponse = await requestApi<{ token: string }>(
          '/auth/login',
          {
            method: 'POST',
            body: JSON.stringify({ username, password }),
          },
        );
        tokenStorage.write(loginResponse.token);
        setUser(await loadAuthenticatedUser());
      },
      logout() {
        tokenStorage.clear();
        setUser(null);
        window.location.assign('/login');
      },
      can(action: string, subject: string) {
        if (user?.isRoot) {
          return true;
        }
        return (
          user?.permissions.some(
            (permission) =>
              (permission.action === 'manage' &&
                permission.subject === 'all') ||
              (permission.action === action &&
                permission.subject === subject),
          ) ?? false
        );
      },
    }),
    [user],
  );

  if (isLoading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background">
        <div className="flex w-64 flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </main>
    );
  }

  return (
    <AuthenticationContext.Provider value={contextValue}>
      {children}
    </AuthenticationContext.Provider>
  );
}

export function useAuthentication(): AuthenticationContextValue {
  const authentication = useContext(AuthenticationContext);
  if (!authentication) {
    throw new Error(
      'useAuthentication 必须在 AuthenticationProvider 内使用',
    );
  }
  return authentication;
}
