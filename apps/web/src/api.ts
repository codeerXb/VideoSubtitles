const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const requestInit = { credentials: "include" as const, ...init, headers: { "content-type": "application/json", ...init.headers } };
  let response = await fetch(`${API_URL}${path}`, requestInit);
  if (response.status === 401 && !path.startsWith("/v1/auth/")) {
    const refreshed = await fetch(`${API_URL}/v1/auth/refresh`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" } });
    if (refreshed.ok) response = await fetch(`${API_URL}${path}`, requestInit);
  }
  const payload = await response.json().catch(() => null) as T & { message?: string } | null;
  if (!response.ok) throw new Error(payload && "message" in payload ? payload.message : `请求失败：${response.status}`);
  return payload as T;
}

export { API_URL };
