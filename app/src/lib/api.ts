/**
 * Typed fetch client. All calls go through the Vite dev proxy
 * (/api/* → backend services). In production, configure a reverse proxy.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  opts: { jwt?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers['Authorization'] = `Bearer ${opts.jwt}`;

  const res = await fetch(path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T>(path: string, jwt?: string) => request<T>('GET', path, { jwt }),
  post: <T>(path: string, body: unknown, jwt?: string) => request<T>('POST', path, { body, jwt }),
  put: <T>(path: string, body: unknown, jwt?: string) => request<T>('PUT', path, { body, jwt }),
  patch: <T>(path: string, body: unknown, jwt?: string) => request<T>('PATCH', path, { body, jwt }),
  del: <T>(path: string, jwt?: string) => request<T>('DELETE', path, { jwt }),
};
