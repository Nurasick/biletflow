import { API_V1_URL } from '@/constants/api';

export async function requestPasswordReset(email: string) {
  let response: Response;
  try {
    response = await fetch(`${API_V1_URL}/auth/password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase() }),
    });
  } catch {
    throw new Error('Could not reach the BiletFlow API. Check your connection and try again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && 'detail' in body
      ? (body as { detail?: unknown }).detail
      : null;
    throw new Error(typeof detail === 'string' ? detail : 'Could not request a password reset. Please try again.');
  }
}
