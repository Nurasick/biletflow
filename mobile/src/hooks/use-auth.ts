import { useState, useCallback } from 'react';

interface AuthState {
  isLoggedIn: boolean;
  user: { email?: string } | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isLoggedIn: true,              //TODO: Change this to false in production
    user: null,
    loading: false,
    error: null,
  });

  const login = useCallback(async (email: string, password: string) => {
    setAuthState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      // TODO: Call your backend API
      // const response = await fetch('http://your-backend/api/v1/login', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ email, password }),
      // });
      // const data = await response.json();
      // if (!response.ok) throw new Error(data.detail || 'Login failed');

      setAuthState({
        isLoggedIn: true,
        user: { email },
        loading: false,
        error: null,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed';
      setAuthState((prev) => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));
    }
  }, []);

  const logout = useCallback(() => {
    setAuthState({
      isLoggedIn: false,
      user: null,
      loading: false,
      error: null,
    });
  }, []);

  return {
    isLoggedIn: authState.isLoggedIn,
    user: authState.user,
    loading: authState.loading,
    error: authState.error,
    login,
    logout,
  };
}
