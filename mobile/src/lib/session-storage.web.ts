// Web builds keep refresh tokens in tab-scoped storage; native uses SecureStore.
export async function getItemAsync(key: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Storage may be blocked by browser settings. Start signed out.
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    if (typeof window === 'undefined') throw new Error('Browser storage unavailable');
    window.sessionStorage.setItem(key, value);
  } catch {
    throw new Error('Your browser cannot remember this session. Disable Remember me and sign in again.');
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(key); } catch { /* Storage can be blocked. */ }
}
