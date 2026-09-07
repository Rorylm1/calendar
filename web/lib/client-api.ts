'use client';
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/calendar/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
    ...(method === 'GET'
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
        }),
  });
  const result = (await response.json()) as T & {
    error?: { message?: string; code?: string };
  };
  if (!response.ok) {
    const error = new Error(
      result.error?.message || 'Please try again.',
    ) as Error & { code?: string };
    error.code = result.error?.code;
    throw error;
  }
  return result;
}
