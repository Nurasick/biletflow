import { apiBaseUrl } from "./urls";
import { randomId } from "../lib/randomId";

export type User = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  status: "active" | "suspended";
  is_email_verified: boolean;
  locale: string;
  created_at: string;
  phone?: string | null;
  // Roles come from the real session (audit #9). Event admin is per event,
  // so it is not here: see GET /staff/events.
  is_platform_admin?: boolean;
  is_organizer?: boolean;
};

export type LoginCredentials = {
  email: string;
  password: string;
};

export type RegistrationInput = {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  phone?: string;
  locale: "kk" | "ru" | "en";
};

type ErrorDetail = {
  msg?: string;
  loc?: Array<string | number>;
};

type StructuredErrorDetail = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

export class ApiError extends Error {
  status: number;
  fieldErrors: Record<string, string>;
  details: StructuredErrorDetail | null;

  constructor(
    message: string,
    status: number,
    fieldErrors: Record<string, string> = {},
    details: StructuredErrorDetail | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.details = details;
  }
}

const parseError = async (response: Response) => {
  let message = `Request failed with status ${response.status}`;
  const fieldErrors: Record<string, string> = {};
  let details: StructuredErrorDetail | null = null;

  try {
    const payload = (await response.json()) as {
      detail?: string | ErrorDetail[] | StructuredErrorDetail;
      message?: string;
    };

    if (typeof payload.detail === "string") {
      message = payload.detail;
    } else if (Array.isArray(payload.detail)) {
      for (const detail of payload.detail) {
        const field = detail.loc?.at(-1);
        if (typeof field === "string" && detail.msg) {
          fieldErrors[field] = detail.msg;
        }
      }
      message = payload.detail[0]?.msg ?? message;
    } else if (payload.detail && typeof payload.detail === "object") {
      details = payload.detail;
      message = typeof details.message === "string" ? details.message : message;
    } else if (payload.message) {
      message = payload.message;
    }
  } catch {
    // add soon
  }

  return new ApiError(message, response.status, fieldErrors, details);
};

const rawResponse = async (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw await parseError(response);
  }
  return response;
};

const readJson = async <T>(response: Response) => {
  if (response.status === 204) {
    return null as T;
  }

  const body = await response.text();
  return (body ? JSON.parse(body) : null) as T;
};

export const rawRequest = async <T>(path: string, init?: RequestInit) =>
  readJson<T>(await rawResponse(path, init));

type TokenResponse = {
  access_token: string;
  csrf_token: string;
};

// The session ID signals sign-in across tabs. A CSRF rotation belongs to the same login.
const CSRF_KEY = "biletflow.auth.csrf";
const SESSION_KEY = "biletflow.auth.session";
let accessToken: string | null = null;
let accessSession: string | null = null;
let refreshPromise: Promise<void> | null = null;

const clearSession = () => {
  accessToken = null;
  localStorage.removeItem(CSRF_KEY);
  localStorage.removeItem(SESSION_KEY);
};

const saveTokens = (tokens: TokenResponse, newLogin = false) => {
  localStorage.setItem(CSRF_KEY, tokens.csrf_token);
  if (newLogin) localStorage.setItem(SESSION_KEY, randomId());
  accessSession = localStorage.getItem(SESSION_KEY);
  accessToken = tokens.access_token;
};

const withSessionLock = <T>(operation: () => Promise<T>) =>
  navigator.locks ? navigator.locks.request("biletflow.auth.refresh", operation) : operation();

const refreshTokens = async () => {
  const session = localStorage.getItem(SESSION_KEY);
  const csrf = localStorage.getItem(CSRF_KEY);
  if (!csrf) throw new ApiError("Please sign in to continue.", 401);
  try {
    const tokens = await rawRequest<TokenResponse>("/auth/refresh", {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
    });
    if (session !== localStorage.getItem(SESSION_KEY)) throw new DOMException("Session changed", "AbortError");
    saveTokens(tokens);
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status) && csrf === localStorage.getItem(CSRF_KEY)) clearSession();
    throw error;
  }
};

const refreshSession = () => refreshPromise ??= withSessionLock(refreshTokens)
  .finally(() => { refreshPromise = null; });

const authenticatedResponse = async (path: string, init?: RequestInit, refresh = refreshSession) => {
  const session = localStorage.getItem(SESSION_KEY);
  const checkSession = () => {
    if (session !== localStorage.getItem(SESSION_KEY)) throw new DOMException("Session changed", "AbortError");
  };
  if (!accessToken || accessSession !== session) await refresh();
  const request = () => {
    checkSession();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return rawResponse(path, { ...init, headers });
  };
  const attemptedToken = accessToken;
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || init?.signal?.aborted) {
      throw error;
    }
    checkSession();
    if (accessToken === attemptedToken) await refresh();
    return request();
  }
};

export const authenticatedRequest = async <T>(path: string, init?: RequestInit) =>
  readJson<T>(await authenticatedResponse(path, init));

window.addEventListener("storage", (event) => {
  const signedIn = event.key === SESSION_KEY && event.newValue && event.newValue !== event.oldValue;
  const signedOut = event.key === null || (event.key === CSRF_KEY && event.newValue === null);
  if (!signedIn && !signedOut) return;
  accessToken = null;
  window.dispatchEvent(new Event(signedIn ? "biletflow:session-changed" : "biletflow:session-ended"));
});

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// For endpoints that work signed in or out (checkout, guest order links):
// attach the session when there is one, never force a sign-in.
const optionalAuthResponse = async (path: string, init?: RequestInit) => {
  if (accessToken || localStorage.getItem(CSRF_KEY)) {
    try {
      return await authenticatedResponse(path, init);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || localStorage.getItem(CSRF_KEY)) throw error;
    }
  }
  return rawResponse(path, init);
};

export const optionalAuthRequest = async <T>(path: string, init?: RequestInit) =>
  readJson<T>(await optionalAuthResponse(path, init));

const fileRequest = async (request: typeof rawResponse, path: string, mediaType: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set("Accept", mediaType);
  const response = await request(path, { ...init, headers });
  if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== mediaType) {
    throw new ApiError("Unexpected download format", 502);
  }
  return response.blob();
};

export const publicFile = (path: string, mediaType: string) => fileRequest(rawResponse, path, mediaType);
export const optionalAuthFile = (path: string, mediaType: string, init?: RequestInit) =>
  fileRequest(optionalAuthResponse, path, mediaType, init);

export const api = {
  get: <T>(path: string, init?: RequestInit) => authenticatedRequest<T>(path, init),
  post: <T>(path: string, body?: unknown) => authenticatedRequest<T>(path, json("POST", body)),
  put: <T>(path: string, body: unknown) => authenticatedRequest<T>(path, json("PUT", body)),
  patch: <T>(path: string, body: unknown) => authenticatedRequest<T>(path, json("PATCH", body)),
  delete: <T>(path: string) => authenticatedRequest<T>(path, { method: "DELETE" }),
  file: (path: string, mediaType: string) => fileRequest(authenticatedResponse, path, mediaType),
  json,
};

export const authApi = {
  verifyEmail: async (token: string) => {
    await rawRequest<null>("/auth/verify-email", json("POST", { token }));
    return { message: "verified" };
  },
  resendVerification: async () => {
    await authenticatedRequest<unknown>("/users/me/verify-email", { method: "POST" });
    return { message: "sent" };
  },
  // The backend answers the same whether or not the address has an account.
  forgotPassword: async (email: string) => {
    await rawRequest<unknown>("/auth/password-reset", json("POST", { email }));
    return { message: "sent" };
  },
  resetPassword: async (token: string, password: string) => {
    await rawRequest<null>("/auth/password-reset/confirm", json("POST", { token, new_password: password }));
    return { message: "reset" };
  },
  currentUser: async ({ signal }: { signal?: AbortSignal } = {}) => {
    if (!accessToken && !localStorage.getItem(CSRF_KEY)) return null;
    try {
      return await authenticatedRequest<User>("/users/me", { signal });
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        clearSession();
        return null;
      }
      throw error;
    }
  },

  login: async ({ email, password }: LoginCredentials) => {
    if (refreshPromise) await refreshPromise.catch(() => undefined);
    await withSessionLock(async () => {
      const tokens = await rawRequest<TokenResponse>("/auth/login", json("POST", { email, password }));
      saveTokens(tokens, true);
    });
    return authenticatedRequest<User>("/users/me");
  },

  register: (input: RegistrationInput) =>
    rawRequest<User>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),

  logout: async () => {
    if (refreshPromise) await refreshPromise.catch(() => undefined);
    await withSessionLock(async () => {
      try {
        await authenticatedResponse("/auth/logout", { method: "POST" }, refreshTokens);
      } catch (error) {
        if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) throw error;
      }
      clearSession();
    });
  },
};

export const getAuthErrorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status >= 500) {
    return "The service is unavailable. Please try again shortly.";
  }
  return error.message || fallback;
};
