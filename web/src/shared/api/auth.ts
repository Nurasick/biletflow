const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, "");

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

export class ApiError extends Error {
  status: number;
  fieldErrors: Record<string, string>;

  constructor(
    message: string,
    status: number,
    fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

const parseError = async (response: Response) => {
  let message = `Request failed with status ${response.status}`;
  const fieldErrors: Record<string, string> = {};

  try {
    const payload = (await response.json()) as {
      detail?: string | ErrorDetail[];
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
    } else if (payload.message) {
      message = payload.message;
    }
  } catch {
    // add soon
  }

  return new ApiError(message, response.status, fieldErrors);
};

export const rawRequest = async <T>(path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return null as T;
  }

  const body = await response.text();
  return (body ? JSON.parse(body) : null) as T;
};

type TokenResponse = {
  access_token: string;
  csrf_token: string;
};

// Access tokens stay in memory. Only the CSRF proof is persisted; the refresh
// credential remains in the backend's HttpOnly cookie.
const CSRF_KEY = "biletflow.auth.csrf";
let accessToken: string | null = null;
let refreshPromise: Promise<void> | null = null;

const clearSession = () => {
  accessToken = null;
  localStorage.removeItem(CSRF_KEY);
};

const saveTokens = (tokens: TokenResponse) => {
  localStorage.setItem(CSRF_KEY, tokens.csrf_token);
  accessToken = tokens.access_token;
};

const refreshSession = () => {
  if (!refreshPromise) {
    const refresh = async () => {
      const csrf = localStorage.getItem(CSRF_KEY);
      if (!csrf) throw new ApiError("Please sign in to continue.", 401);
      try {
        saveTokens(await rawRequest<TokenResponse>("/auth/refresh", {
          method: "POST",
          headers: { "X-CSRF-Token": csrf },
        }));
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) {
          clearSession();
        }
        throw error;
      }
    };
    refreshPromise = (navigator.locks
      ? navigator.locks.request("biletflow.auth.refresh", refresh)
      : refresh()).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
};

export const authenticatedRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  if (!accessToken) await refreshSession();
  const request = () => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return rawRequest<T>(path, { ...init, headers });
  };
  const attemptedToken = accessToken;
  try {
    return await request();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || init?.signal?.aborted) {
      throw error;
    }
    if (accessToken === attemptedToken) await refreshSession();
    return request();
  }
};

// Another tab signing out removes the CSRF proof; another tab signing in as a
// different account replaces it. Either way the access token held here belongs
// to the old session, so drop it and tell the app to reload who is signed in
// (audit #17: an A tab silently became B on its next refresh).
window.addEventListener("storage", (event) => {
  if (event.key !== CSRF_KEY && event.key !== null) return;
  if (event.key === CSRF_KEY && event.newValue === event.oldValue) return;
  accessToken = null;
  window.dispatchEvent(new Event(event.key === CSRF_KEY && event.newValue
    ? "biletflow:session-changed" : "biletflow:session-ended"));
});

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// For endpoints that work signed in or out (checkout, guest order links):
// attach the session when there is one, never force a sign-in.
export const optionalAuthRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  if (accessToken || localStorage.getItem(CSRF_KEY)) {
    try {
      return await authenticatedRequest<T>(path, init);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      clearSession();
    }
  }
  return rawRequest<T>(path, init);
};

export const api = {
  get: <T>(path: string, init?: RequestInit) => authenticatedRequest<T>(path, init),
  post: <T>(path: string, body?: unknown) => authenticatedRequest<T>(path, json("POST", body)),
  put: <T>(path: string, body: unknown) => authenticatedRequest<T>(path, json("PUT", body)),
  patch: <T>(path: string, body: unknown) => authenticatedRequest<T>(path, json("PATCH", body)),
  delete: <T>(path: string) => authenticatedRequest<T>(path, { method: "DELETE" }),
  json,
};

export const authApi = {
  verifyEmail: async (token: string) => {
    await rawRequest<null>("/auth/verify-email", json("POST", { token }));
    return { message: "verified" };
  },
  resendVerification: async (_email: string) => {
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
    const tokens = await rawRequest<TokenResponse>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    saveTokens(tokens);
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
    try {
      await authenticatedRequest<null>("/auth/logout", { method: "POST" });
    } catch (error) {
      if (!(error instanceof ApiError) || ![401, 403].includes(error.status)) throw error;
    }
    clearSession();
  },
};

export const getAuthErrorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status >= 500) {
    return "The service is unavailable. Please try again shortly.";
  }
  return error.message || fallback;
};
