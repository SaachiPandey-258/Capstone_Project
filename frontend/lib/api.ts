import type { Assessment, Dashboard, SpecialistSearch, SpecialistSearchResult, User } from "@/lib/types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "parkinson-portal-token";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function saveToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Cannot reach the service. Check that the API is running and try again.", 0);
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : "The request could not be completed.";
    if (response.status === 401 && token) {
      clearToken();
      window.dispatchEvent(new Event("portal:session-expired"));
    }
    throw new ApiError(detail, response.status);
  }
  return payload as T;
}

export const api = {
  async register(email: string, password: string) {
    const result = await request<{ access_token: string; user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    saveToken(result.access_token);
    return result.user;
  },
  async login(email: string, password: string) {
    const result = await request<{ access_token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    saveToken(result.access_token);
    return result.user;
  },
  async googleLogin(credential: string) {
    const result = await request<{ access_token: string; user: User }>("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    saveToken(result.access_token);
    return result.user;
  },
  me: () => request<User>("/api/auth/me"),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  assessments: () => request<Assessment[]>("/api/assessments"),
  assessment: (id: string) => request<Assessment>(`/api/assessments/${encodeURIComponent(id)}`),
  reports: () => request<Assessment[]>("/api/reports"),
  report: (id: string) => request<Assessment>(`/api/reports/${encodeURIComponent(id)}`),
  submitAssessment: (body: FormData) =>
    request<Assessment>("/api/assessments", { method: "POST", body }),
  specialists: (search: SpecialistSearch) => {
    const query = new URLSearchParams({
      location: search.location,
      category: search.category,
      radius: String(search.radius),
      ...(search.latitude !== undefined ? { latitude: String(search.latitude) } : {}),
      ...(search.longitude !== undefined ? { longitude: String(search.longitude) } : {}),
    });
    return request<SpecialistSearchResult>(`/api/specialists?${query.toString()}`);
  },
};

export { API_URL };
