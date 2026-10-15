import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { API_V1_URL } from '@/constants/api';

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
    throw new Error(getErrorMessage(responseBody, response.status));
  }

  if (!isTokenResponse(responseBody) || !responseBody.refresh_token) {
    throw new Error('The API did not return a valid mobile session.');
  }

  return responseBody;
}

async function saveStoredSession(session: AuthSession) {
  await SecureStore.setItemAsync(
    SESSION_STORAGE_KEY,
    JSON.stringify({ email: session.user.email, refreshToken: session.refreshToken } satisfies StoredSession),
  );
}

async function readStoredSession(): Promise<StoredSession | null> {
  const stored = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
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

  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
  return null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restoreSession = useCallback(async () => {
    try {
      const stored = await readStoredSession();
      if (!stored) {
        return;
      }

      const tokens = await requestTokens('/refresh', { refresh_token: stored.refreshToken });
      const restoredSession: AuthSession = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        user: { email: stored.email },
        rememberMe: true,
      };

      await saveStoredSession(restoredSession);
      setSession(restoredSession);
    } catch {
      await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
      setSession(null);
    } finally {
      setIsRestoring(false);
    }
  }, []);

  useEffect(() => {
    const restoreTimer = setTimeout(() => {
      void restoreSession();
    }, 0);

    return () => clearTimeout(restoreTimer);
  }, [restoreSession]);

  const refreshSession = useCallback(async () => {
    if (!session) {
      throw new Error('Your session has ended. Please sign in again.');
    }

    try {
      const tokens = await requestTokens('/refresh', { refresh_token: session.refreshToken });
      const refreshedSession: AuthSession = {
        ...session,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      };

      if (refreshedSession.rememberMe) {
        await saveStoredSession(refreshedSession);
      }

      setSession(refreshedSession);
      return refreshedSession;
    } catch (refreshError) {
      await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
      setSession(null);
      throw refreshError;
    }
  }, [session]);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const tokens = await requestTokens('/login', { email: normalizedEmail, password });
      const nextSession: AuthSession = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        user: { email: normalizedEmail },
        rememberMe,
      };

      if (rememberMe) {
        await saveStoredSession(nextSession);
      } else {
        await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
      }

      setSession(nextSession);
      return true;
    } catch (loginError) {
      setSession(null);
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    const activeSession = session;
    setSession(null);
    setError(null);
    await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);

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
  }, [session]);

  const authenticatedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!session) {
        throw new Error('Your session has ended. Please sign in again.');
      }

      const request = (accessToken: string) => {
        const headers = new Headers(init.headers);
        headers.set('Authorization', `Bearer ${accessToken}`);
        const url = path.startsWith('http://') || path.startsWith('https://') ? path : `${API_V1_URL}${path}`;
        return fetch(url, { ...init, headers });
      };

      const response = await request(session.accessToken);
      if (response.status !== 401) {
        return response;
      }

      const refreshedSession = await refreshSession();
      return request(refreshedSession.accessToken);
    },
    [refreshSession, session],
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
