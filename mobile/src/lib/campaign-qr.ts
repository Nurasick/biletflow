function isLocalOrPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '10.0.2.2') {
    return true;
  }
  if (normalized.length > '.local'.length && normalized.endsWith('.local')) {
    return true;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const c = Number(match[3]);
  const d = Number(match[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function campaignFromUrl(raw: string, apiBaseUrl: string): { slug: string; token: string } | null {
  try {
    const url = new URL(raw);
    const api = new URL(apiBaseUrl);
    const isLoopback = ['localhost', '127.0.0.1'].includes(url.hostname);
    const protocolAllowed =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ((api.protocol === 'http:' &&
          (url.hostname === api.hostname || ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname))) ||
          isLoopback));
    if (!protocolAllowed) return null;

    const hostnameAllowed =
      url.hostname === api.hostname ||
      ['biletflow.kz', 'www.biletflow.kz'].includes(url.hostname) ||
      (api.protocol === 'http:' && isLocalOrPrivateHost(api.hostname) && isLoopback);
    if (!hostnameAllowed) return null;

    const match = url.pathname.match(/\/events\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i);
    const token = url.searchParams.get('c');
    return match && token && token.length <= 64 ? { slug: match[1], token } : null;
  } catch {
    return null;
  }
}
