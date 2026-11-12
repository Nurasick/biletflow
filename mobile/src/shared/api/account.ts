import { API_V1_URL } from '@/constants/api';
import type { AuthenticatedFetch } from './orders';

export type Account = {
  id: number; email: string; first_name: string; last_name: string; phone: string | null;
  locale: 'en' | 'kk' | 'ru'; is_email_verified: boolean; is_organizer: boolean;
};

export async function accountResponse<T>(response: Response): Promise<T> {
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'The account request failed. Please try again.');
  }
  return body as T;
}

export const accountApi = {
  get: async (fetcher: AuthenticatedFetch, signal?: AbortSignal) => accountResponse<Account>(await fetcher('/users/me', { signal })),
  update: async (fetcher: AuthenticatedFetch, firstName: string, lastName: string, phone: string, locale: Account['locale']) => {
    if (!firstName.trim() || !lastName.trim()) throw new Error('Enter your first and last name.');
    return accountResponse<Account>(await fetcher('/users/me', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim() || null, locale }),
    }));
  },
  resendVerification: async (fetcher: AuthenticatedFetch) => accountResponse(await fetcher('/users/me/verify-email', { method: 'POST' })),
  reset: async (token: string, password: string) => {
    if (!token.trim() || token.length > 200) throw new Error('Enter the token from your email link.');
    if (password.length < 8 || password.length > 50) throw new Error('Use a password of 8–50 characters.');
    return accountResponse(await fetch(`${API_V1_URL}/auth/password-reset/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.trim(), new_password: password }),
    }));
  },
  verify: async (token: string) => {
    if (!token.trim() || token.length > 200) throw new Error('Enter the token from your email link.');
    return accountResponse(await fetch(`${API_V1_URL}/auth/verify-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.trim() }),
    }));
  },
};
