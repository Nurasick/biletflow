import * as SessionStorage from '@/lib/session-storage';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { API_V1_URL } from '@/constants/api';
import { singleFlight } from '@/lib/single-flight';

const SESSION_STORAGE_KEY = 'biletflow.auth.session.v1';

export type AuthUser = {
  email: string;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
};

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  rememberMe: boolean;
};

type StoredSession = {
  email: string;
  refreshToken: string;
};

type AuthContextValue = {
  isLoggedIn: boolean;
  isRestoring: boolean;
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string, rememberMe: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
  authenticatedFetch: (path: string, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

class AuthRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function getErrorMessage(body: unknown, status: number) {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
  }

  return status >= 500 ? 'The server could not complete your request. Please try again.' : 'Unable to sign in.';
}

function isTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const token = value as { access_token?: unknown; refresh_token?: unknown };
  return typeof token.access_token === 'string' && (typeof token.refresh_token === 'string' || token.refresh_token === null);
}

async function requestTokens(path: '/login' | '/refresh', body: Record<string, string>): Promise<TokenResponse> {
  let response: Response;

  try {
    response = await fetch(`${API_V1_URL}/auth${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Mode': 'bearer',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the BiletFlow API. Check EXPO_PUBLIC_API_URL and that the backend is running.');
  }

  const responseBody: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AuthRequestError(getErrorMessage(responseBody, response.status), response.status);
  }

  if (!isTokenResponse(responseBody) || !responseBody.refresh_token) {
    throw new Error('The API did not return a valid mobile session.');
  }

  return responseBody;
}

async function clearStoredSession() {
  try {
    await SessionStorage.deleteItemAsync(SESSION_STORAGE_KEY);
  } catch {
    // Storage failures must not interrupt startup or local sign-out.
  }
}

async function saveStoredSession(session: AuthSession) {
  await SessionStorage.setItemAsync(
    SESSION_STORAGE_KEY,
    JSON.stringify({ email: session.user.email, refreshToken: session.refreshToken } satisfies StoredSession),
  );
}

async function readStoredSession(): Promise<StoredSession | null> {
  const stored = await SessionStorage.getItemAsync(SESSION_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredSession).email === 'string' &&
      typeof (parsed as StoredSession).refreshToken === 'string'
    ) {
      return parsed as StoredSession;
    }
  } catch {
    // Treat an invalid local value as an expired session.
  }

  await clearStoredSession();
  return null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const sessionRef = useRef<AuthSession | null>(null);
  const refreshOnce = useRef(singleFlight<AuthSession>());
  const sessionVersion = useRef(0);
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const persist = useCallback((next: AuthSession | null, version: number) => {
    const operation = persistence.current.catch(() => {}).then(async () => {
      if (version !== sessionVersion.current) return;
      if (next?.rememberMe) await saveStoredSession(next);
      else await clearStoredSession();
    });
    persistence.current = operation.catch(() => {});
    return operation;
  }, []);
  const commitSession = useCallback((next: AuthSession | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);
  const [isRestoring, setIsRestoring] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restoreSession = useCallback(async () => {
    const version = sessionVersion.current;
    try {
      const stored = await readStoredSession();
      if (!stored) {
        return;
      }

      const tokens = await requestTokens('/refresh', { refresh_token: stored.refreshToken });
      if (version !== sessionVersion.current) return;
      const restoredSession: AuthSession = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        user: { email: stored.email },
        rememberMe: true,
      };

      await persist(restoredSession, version);
      if (version !== sessionVersion.current) return;
      commitSession(restoredSession);
    } catch {
      await persist(null, version);
      if (version === sessionVersion.current) commitSession(null);
    } finally {
      setIsRestoring(false);
    }
  }, [commitSession, persist]);

  useEffect(() => {
    const restoreTimer = setTimeout(() => {
      void restoreSession();
    }, 0);

    return () => clearTimeout(restoreTimer);
  }, [restoreSession]);

  const refreshSession = useCallback(() => refreshOnce.current(async () => {
    const activeSession = sessionRef.current;
    const version = sessionVersion.current;
    if (!activeSession) {
      throw new Error('Your session has ended. Please sign in again.');
    }

    try {
      const tokens = await requestTokens('/refresh', { refresh_token: activeSession.refreshToken });
      if (sessionRef.current !== activeSession) throw new Error('Your session has changed. Please try again.');
      const refreshedSession: AuthSession = {
        ...activeSession,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      };

      if (refreshedSession.rememberMe) {
        await persist(refreshedSession, version);
      }

      if (sessionRef.current !== activeSession) throw new Error('Your session has changed. Please try again.');
      commitSession(refreshedSession);
      return refreshedSession;
    } catch (refreshError) {
      if (sessionRef.current === activeSession && refreshError instanceof AuthRequestError && [401, 403].includes(refreshError.status)) {
        commitSession(null);
        await persist(null, version);
      }
      throw refreshError;
    }
  }), [commitSession, persist]);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean) => {
    const version = ++sessionVersion.current;
    setLoading(true);
    setError(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const tokens = await requestTokens('/login', { email: normalizedEmail, password });
      if (version !== sessionVersion.current) return false;
      const nextSession: AuthSession = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        user: { email: normalizedEmail },
        rememberMe,
      };

      await persist(nextSession, version);

      if (version !== sessionVersion.current) return false;
      commitSession(nextSession);
      return true;
    } catch (loginError) {
      if (version === sessionVersion.current) {
        commitSession(null);
        await persist(null, version);
      }
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [commitSession, persist]);

  const logout = useCallback(async () => {
    const activeSession = sessionRef.current;
    const version = ++sessionVersion.current;
    commitSession(null);
    setError(null);
    await persist(null, version);

    if (activeSession) {
      try {
        await fetch(`${API_V1_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${activeSession.accessToken}`,
          },
        });
      } catch {
        // Local token removal is enough for the bearer-mode client.
      }
    }
  }, [commitSession, persist]);

  const authenticatedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const activeSession = sessionRef.current;
      if (!activeSession) {
        throw new Error('Your session has ended. Please sign in again.');
      }

      const request = (accessToken: string) => {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);
        const url = path.startsWith('http://') || path.startsWith('https://') ? path : `${API_V1_URL}${path}`;
        return fetch(url, { ...init, headers });
      };

      const assertActive = () => {
        if (!init.signal?.aborted) return;
        const aborted = new Error('Request aborted');
        aborted.name = 'AbortError';
        throw aborted;
      };

      assertActive();
      const response = await request(activeSession.accessToken);
      if (response.status !== 401) {
        return response;
      }

      if (sessionRef.current?.refreshToken !== activeSession.refreshToken) {
        assertActive();
        if (!sessionRef.current) throw new Error('Your session has ended. Please sign in again.');
        if (sessionRef.current.user.email !== activeSession.user.email) throw new Error('Your session has changed. Please try again.');
        return request(sessionRef.current.accessToken);
      }
      assertActive();
      const refreshedSession = await refreshSession();
      assertActive();
      return request(refreshedSession.accessToken);
    },
    [refreshSession],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoggedIn: session !== null,
      isRestoring,
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      loading,
      error,
      login,
      logout,
      authenticatedFetch,
    }),
    [authenticatedFetch, error, isRestoring, loading, login, logout, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }

  return auth;
}
