export type ApiTask = {
  id: string;
  title: string;
  description: string | null;
  date: string;
  dueDate: string;
  actionPlan: string | null;
  actionPlanTdc: string | null;
  remarks: string | null;

  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  
  status: "Pending" | "Completed" | "Overdue";
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  officer: {
    id: string;
    name: string;
    designation: string;
    email: string;
  };
  additionalAssignees: {
  id: string;
  name: string;
  designation: string;
  email: string;
}[];
officerUpdates: {
  id: string;
  actionPlan: string | null;
  remark: string | null;

  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;

  createdAt: string;
  updatedAt: string;

  officer: {
    id: string;
    name: string;
    designation: string;
    email: string;
  };
}[];


  offlinePending?: boolean;
  clientRequestId?: string;
  syncState?: "pending" | "syncing" | "failed";
  syncError?: string;
};

export type ApiUser = {
  id: string;
  name: string;
  email: string;
  designation: string;
  role: "ADMIN" | "OFFICER";
  avatar?: string | null;
  taskCount?: number;
  department?: string | null;
  isActive?: boolean;
};

export type ApiStats = {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  dueToday: ApiTask[];
  recentTasks: ApiTask[];
};

const TOKEN_KEY = "railwork_token";
const USER_KEY = "railwork_user";
const REMEMBER_KEY = "railwork_remember";
const OFFLINE_ACCESS_KEY = "railwork_offline_access";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function pickStorage(remember: boolean): StorageLike {
  return remember ? window.localStorage : window.sessionStorage;
}

function storageOf(key: string): StorageLike {
  const local = window.localStorage.getItem(key);
  if (local !== null) return window.localStorage;
  const session = window.sessionStorage.getItem(key);
  if (session !== null) return window.sessionStorage;
  return window.localStorage;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return storageOf(TOKEN_KEY).getItem(TOKEN_KEY);
}

export function setToken(token: string | null, remember = true): void {
  if (typeof window === "undefined") return;
  if (token) {
    const target = pickStorage(remember);
    target.setItem(TOKEN_KEY, token);
    // Remove any stale token from the opposite storage so an un-checked
    // login never falls back to a previously remembered session.
    if (remember) window.sessionStorage.removeItem(TOKEN_KEY);
    else window.localStorage.removeItem(TOKEN_KEY);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
  }
  window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
}

export function setUser(user: ApiUser | null, remember = true): void {
  if (typeof window === "undefined") return;
  if (user) {
    const target = pickStorage(remember);
    target.setItem(USER_KEY, JSON.stringify(user));
    if (remember) window.sessionStorage.removeItem(USER_KEY);
    else window.localStorage.removeItem(USER_KEY);
  } else {
    window.localStorage.removeItem(USER_KEY);
    window.sessionStorage.removeItem(USER_KEY);
  }
}

export function getStoredUser(): ApiUser | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = storageOf(USER_KEY).getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as ApiUser) : null;
  } catch {
    return null;
  }
}

export function enableOfflineAccess(user: ApiUser): void {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(
    OFFLINE_ACCESS_KEY,
    JSON.stringify({
      allowed: true,
      user,
      enabledAt: new Date().toISOString(),
    })
  );
}

export function getOfflineUser(): ApiUser | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(OFFLINE_ACCESS_KEY);

    if (!raw) return null;

    const data = JSON.parse(raw) as {
      allowed?: boolean;
      user?: ApiUser;
    };

    if (!data.allowed || !data.user) return null;

    return data.user;
  } catch {
    return null;
  }
}

export function clearOfflineAccess(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(OFFLINE_ACCESS_KEY);
}

export function getRole(): "ADMIN" | "OFFICER" | null {
  return getStoredUser()?.role ?? null;
}



export function clearAuth(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
  window.localStorage.removeItem(REMEMBER_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(USER_KEY);
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // keep default message
    }
    if (res.status === 401 && typeof window !== "undefined") {
      // Only treat a 401 as a session-ending event when a token was actually
      // sent AND it is confirmed invalid by the auth endpoint itself. A bare
      // 401 (request fired without a token during a loading transition) or a
      // transient/edge-case 401 must NOT wipe the session or bounce the user
      // to the login page.
      const currentToken = getToken();
      if (currentToken) {
        try {
          const check = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${currentToken}` },
          });
          if (check.status === 401 || check.status === 403) {
            clearAuth();
            if (window.location.pathname !== "/") {
              window.location.href = window.location.origin;
            }
          }
          const OFFLINE_ACCESS_KEY = "railwork_offline_access";
        } catch {
          // Verification request itself failed (network/proxy glitch):
          // keep the session intact rather than force a logout.
        }
      }
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export async function updateCurrentUser(
  updates: { name?: string; avatar?: string | null },
  remember?: boolean
): Promise<ApiUser> {
  const data = await apiFetch<{ user: ApiUser }>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
  const stored = getStoredUser();
  setUser(
    {
      ...(stored ?? data.user),
      ...data.user,
    },
    remember ?? stored !== null
  );
  return data.user;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await apiFetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function forgotPassword(
  email: string
): Promise<{ resetToken: string; resetLink: string }> {
  return apiFetch("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(
  token: string,
  newPassword: string
): Promise<void> {
  await apiFetch("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}
