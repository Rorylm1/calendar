'use client';
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

export function createApi(fetcher: typeof fetch, timeoutMs = 30000) {
  return async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeoutError = failure('request_timeout', method === 'GET'
      ? 'Your calendar is taking too long to respond. Please try again.'
      : 'We couldn’t confirm whether that change was saved. Refresh your calendar before trying again.');
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(timeoutError); controller.abort(); }, timeoutMs);
    });
    try {
      // The deadline includes the response body and still settles if a browser
      // fails to abort its network request. Mutations are never replayed.
      return await Promise.race([deadline, (async () => {
        const response = await fetcher(`/api/calendar/${path}`, {
          method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }),
        });
        let result: T & { error?: { message?: string; code?: string } };
        try { result = await response.json(); }
        catch {
          throw failure(response.status === 401 ? 'sign_in_required' : 'service_unavailable', response.status === 401
            ? 'Sign in to open your personal calendar.'
            : 'Your calendar could not be loaded. Please try again.');
        }
        if (!response.ok) throw failure(result?.error?.code || (response.status === 401 ? 'sign_in_required' : 'service_unavailable'), result?.error?.message || 'Your calendar could not be loaded. Please try again.');
        return result;
      })()]);
    } catch (error) {
      if (error instanceof Error && 'code' in error) throw error;
      throw failure('network_error', method === 'GET'
        ? 'Couldn’t reach your calendar. Check your connection and try again.'
        : 'We couldn’t confirm whether that change was saved. Refresh your calendar before trying again.');
    } finally { clearTimeout(timer!); }
  };
}

export const api = createApi((...args) => fetch(...args));
