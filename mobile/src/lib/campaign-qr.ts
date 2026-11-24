export function campaignFromUrl(raw: string, apiBaseUrl: string): { slug: string; token: string } | null {
  try {
    const url = new URL(raw);
    const expected = new URL(apiBaseUrl).hostname;
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return null;
    if (url.hostname !== expected && !['biletflow.kz', 'www.biletflow.kz'].includes(url.hostname)) return null;
    const match = url.pathname.match(/\/events\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
    const token = url.searchParams.get('c');
    return match && token && token.length <= 64 ? { slug: match[1], token } : null;
  } catch {
    return null;
  }
}
