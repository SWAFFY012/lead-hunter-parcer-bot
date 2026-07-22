const BASE = '/api';

export async function api<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
export const put = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined });
export const patch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
