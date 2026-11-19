export const apiBaseUrl = (import.meta.env.VITE_API_URL?.trim() || "/api/v1").replace(/\/+$/, "");

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** Local uploads can have an absolute development URL persisted in the database. */
export function eventImageSrc(source: string): string {
  if (source.startsWith("data:")) return source;
  let url: URL;
  try {
    url = new URL(source, window.location.origin);
  } catch {
    return source;
  }
  if (!url.pathname.startsWith("/media/")) return source;
  if (!source.startsWith("/media/") && !loopbackHosts.has(url.hostname)) return source;

  const apiOrigin = new URL(apiBaseUrl, window.location.origin).origin;
  return apiOrigin + url.pathname + url.search + url.hash;
}
