// Browser persistence for Remember me. Native builds use SecureStore instead.
export async function getItemAsync(key: string): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage may be blocked by browser settings. Start signed out.
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    if (typeof window === 'undefined') throw new Error('Browser storage unavailable');
    window.localStorage.setItem(key, value);
  } catch {
    throw new Error('Your browser cannot remember this session. Disable Remember me and sign in again.');
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(key);
}
