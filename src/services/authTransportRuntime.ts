import type { AppLanguage } from './i18n';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchAndConsumeWithTimeout } from './requestTimeout';

export interface AuthUser {
  id: string;
  name: string;
  role: "guest" | "admin";
  language: AppLanguage;
  createdAt: string;
}
export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: number;
}
interface AuthRequestOptions {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  token?: string;
}
export interface AuthTransportRuntimeDependencies {
  apiUrl: string;
  getActiveGatewaySecret: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  clearAllRequestCaches?: () => void;
  warn?: (...args: unknown[]) => void;
}
export interface AuthTransportRuntime {
  authRequest: <T>(path: string, options?: AuthRequestOptions) => Promise<T>;
  validateGatewaySecret: (secret: string) => Promise<boolean>;
  getAuthStatus: () => Promise<{ setupRequired: boolean; userCount: number }>;
  loginAccount: (name: string, password: string) => Promise<AuthSession>;
  bootstrapAdmin: (name: string, password: string, bootstrapSecret: string) => Promise<AuthSession>;
  getCurrentUser: () => Promise<AuthUser>;
  listUsers: () => Promise<AuthUser[]>;
  createUser: (input: { name: string; password: string; role: "guest" | "admin"; language?: AppLanguage }) => Promise<AuthUser>;
  updateUser: (id: string, input: { name: string; role: "guest" | "admin"; language?: AppLanguage; password?: string }) => Promise<AuthUser>;
  updateMyLanguage: (language: AppLanguage) => Promise<AuthUser>;
  deleteUser: (id: string) => Promise<void>;
  logoutAccount: () => Promise<void>;
  clearRequestCaches: () => void;
}

/** Owns authenticated Worker requests, token-scoped identity caches and session mutations. */
export function createAuthTransportRuntime(dependencies: AuthTransportRuntimeDependencies): AuthTransportRuntime {
  const fetchImpl = dependencies.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = dependencies.now || Date.now;
  const warn = dependencies.warn || ((...args: unknown[]) => console.warn(...args));
  const AUTH_READ_TTL_MS = 15_000;
  const CURRENT_USER_READ_TTL_MS = 5_000;
  const authReadRequests = new Map<string, Promise<unknown>>();
  let currentUserCache: { token: string; expiresAt: number; user: AuthUser } | null = null;
  let usersCache: { token: string; expiresAt: number; users: AuthUser[] } | null = null;
  let usersRequest: { token: string; generation: number; promise: Promise<AuthUser[]> } | null = null;
  let usersCacheGeneration = 0;

  const normalizeAuthUser = (value: unknown): AuthUser | null => {
    if (!value || typeof value !== "object") return null;
    const user = value as Partial<AuthUser>;
    if (typeof user.id !== "string" || typeof user.name !== "string" ||
        (user.role !== "admin" && user.role !== "guest") || typeof user.createdAt !== "string") {
      return null;
    }
    return { ...user, language: user.language === "ru" ? "ru" : "en" } as AuthUser;
  };

  const normalizeAuthSession = (session: AuthSession): AuthSession => {
    const user = normalizeAuthUser(session?.user);
    if (!user || typeof session?.token !== "string" || !session.token.trim() ||
        typeof session.expiresAt !== "number" || !Number.isFinite(session.expiresAt)) {
      throw new Error("The authenticated user response was invalid.");
    }
    return { ...session, user };
  };

  const rememberCurrentUser = (token: string, user: AuthUser): void => {
    currentUserCache = { token, user, expiresAt: now() + CURRENT_USER_READ_TTL_MS };
  };

  const invalidateUserDirectoryCache = (token: string): void => {
    usersCacheGeneration += 1;
    usersCache = null;
    usersRequest = null;
    currentUserCache = null;
    authReadRequests.delete(JSON.stringify(["/api/auth/users", token]));
  };

  const clearRequestCaches = (): void => {
    authReadRequests.clear();
    currentUserCache = null;
    usersCache = null;
    usersRequest = null;
    usersCacheGeneration += 1;
  };

  const performAuthRequest = async <T>(path: string, options: AuthRequestOptions = {}): Promise<T> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
      headers["X-App-Auth"] = options.token;
    }
    return fetchAndConsumeWithTimeout(
      fetchImpl,
      new URL(path, dependencies.apiUrl),
      {
        method: options.method || "GET",
        headers,
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        cache: "no-store"
      },
      async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || `Authentication request failed (HTTP ${response.status}).`);
        return payload as T;
      },
      DEFAULT_REQUEST_TIMEOUT_MS
    );
  };

  const authRequest = <T>(path: string, options: AuthRequestOptions = {}): Promise<T> => {
    const method = (options.method || "GET").toUpperCase();
    if (method === "GET" && !options.body) {
      const key = JSON.stringify([path, options.token || ""]);
      const existing = authReadRequests.get(key);
      if (existing) return existing as Promise<T>;
      const request = performAuthRequest<T>(path, options);
      authReadRequests.set(key, request);
      void request.finally(() => {
        if (authReadRequests.get(key) === request) authReadRequests.delete(key);
      }).catch(() => {
        // The original caller owns error handling; ignore the cleanup chain.
      });
      return request;
    }
    return performAuthRequest<T>(path, options);
  };

  const validateGatewaySecret = async (secret: string): Promise<boolean> => {
    const cleanSecret = typeof secret === "string" ? secret.trim() : "";
    if (!cleanSecret) return false;
    try {
      return await fetchAndConsumeWithTimeout(fetchImpl, new URL("/api/auth/me", dependencies.apiUrl), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-App-Auth": cleanSecret,
          Authorization: `Bearer ${cleanSecret}`
        },
        cache: "no-store"
      }, async (response) => {
        if (!response.ok) {
          currentUserCache = null;
          return false;
        }
        const payload = typeof response.json === "function"
          ? await response.json().catch(() => null)
          : null;
        const user = normalizeAuthUser(payload?.user);
        if (!user) {
          currentUserCache = null;
          return false;
        }
        rememberCurrentUser(cleanSecret, user);
        return true;
      }, DEFAULT_REQUEST_TIMEOUT_MS);
    } catch (error) {
      warn("Account session validation failed:", error);
      return false;
    }
  };

  const getAuthStatus = (): Promise<{ setupRequired: boolean; userCount: number }> =>
    authRequest("/api/auth/status");

  const loginAccount = async (name: string, password: string): Promise<AuthSession> =>
    normalizeAuthSession(await authRequest<AuthSession>("/api/auth/login", {
      method: "POST", body: { name, password }
    }));

  const bootstrapAdmin = async (name: string, password: string, bootstrapSecret: string): Promise<AuthSession> =>
    normalizeAuthSession(await authRequest<AuthSession>("/api/auth/bootstrap", {
      method: "POST", body: { name, password, bootstrapSecret }
    }));

  const getCurrentUser = (): Promise<AuthUser> => {
    const token = dependencies.getActiveGatewaySecret();
    if (!token) return Promise.reject(new Error("Not signed in."));
    if (currentUserCache?.token === token && currentUserCache.expiresAt > now()) {
      return Promise.resolve(currentUserCache.user);
    }
    return authRequest<{ user: unknown }>("/api/auth/me", { token }).then((payload) => {
      const user = normalizeAuthUser(payload?.user);
      if (!user) throw new Error("The authenticated user response was invalid.");
      rememberCurrentUser(token, user);
      return user;
    });
  };

  const listUsers = (): Promise<AuthUser[]> => {
    const token = dependencies.getActiveGatewaySecret();
    if (!token) return Promise.reject(new Error("Not signed in."));
    if (usersCache?.token === token && usersCache.expiresAt > now()) {
      return Promise.resolve(usersCache.users);
    }
    if (usersRequest?.token === token && usersRequest.generation === usersCacheGeneration) {
      return usersRequest.promise;
    }
    const generation = usersCacheGeneration;
    const request = authRequest<{ users: unknown[] }>("/api/auth/users", { token })
      .then((payload) => {
        if (!Array.isArray(payload?.users)) {
          throw new Error("The user directory response was invalid.");
        }
        const normalizedUsers = payload.users.map(normalizeAuthUser);
        const users = normalizedUsers.filter((user): user is AuthUser => user !== null);
        if (users.length !== normalizedUsers.length) {
          throw new Error("The user directory response was invalid.");
        }
        if (generation === usersCacheGeneration) {
          usersCache = { token, users, expiresAt: now() + AUTH_READ_TTL_MS };
        }
        return users;
      })
      .finally(() => {
        if (usersRequest?.promise === request) usersRequest = null;
      });
    usersRequest = { token, generation, promise: request };
    return request;
  };

  const createUser = async (input: { name: string; password: string; role: "guest" | "admin"; language?: AppLanguage }): Promise<AuthUser> => {
    const token = dependencies.getActiveGatewaySecret();
    if (!token) throw new Error("Not signed in.");
    invalidateUserDirectoryCache(token);
    try {
      return (await authRequest<{ user: AuthUser }>("/api/auth/users", {
        method: "POST", token, body: { action: "create", ...input }
      })).user;
    } finally {
      invalidateUserDirectoryCache(token);
    }
  };

  const updateUser = async (id: string, input: { name: string; role: "guest" | "admin"; language?: AppLanguage; password?: string }): Promise<AuthUser> => {
    const token = dependencies.getActiveGatewaySecret();
    if (!token) throw new Error("Not signed in.");
    invalidateUserDirectoryCache(token);
    try {
      return (await authRequest<{ user: AuthUser }>("/api/auth/users", {
        method: "POST", token, body: { action: "update", id, ...input }
      })).user;
    } finally {
      invalidateUserDirectoryCache(token);
    }
  };

  const updateMyLanguage = async (language: AppLanguage): Promise<AuthUser> => {
    const token = dependencies.getActiveGatewaySecret();
    if (!token) throw new Error("Not signed in.");
    invalidateUserDirectoryCache(token);
    const payload = await authRequest<{ user: unknown }>("/api/auth/me", {
      method: "POST", token, body: { language }
    });
    const user = normalizeAuthUser(payload?.user);
    if (!user) throw new Error("The authenticated user response was invalid.");
    rememberCurrentUser(token, user);
    return user;
  };

  const deleteUser = async (id: string): Promise<void> => {
    const token = dependencies.getActiveGatewaySecret();
    if (!token) throw new Error("Not signed in.");
    invalidateUserDirectoryCache(token);
    try {
      await authRequest<{ success: boolean }>("/api/auth/users", {
        method: "POST", token, body: { action: "delete", id }
      });
    } finally {
      invalidateUserDirectoryCache(token);
    }
  };

  const logoutAccount = async (): Promise<void> => {
    const token = dependencies.getActiveGatewaySecret();
    if (token) await authRequest<{ success: boolean }>("/api/auth/logout", { method: "POST", token, body: {} });
    clearRequestCaches();
    if (dependencies.clearAllRequestCaches) dependencies.clearAllRequestCaches();
  };

  return {
    authRequest,
    validateGatewaySecret,
    getAuthStatus,
    loginAccount,
    bootstrapAdmin,
    getCurrentUser,
    listUsers,
    createUser,
    updateUser,
    updateMyLanguage,
    deleteUser,
    logoutAccount,
    clearRequestCaches
  };
}
