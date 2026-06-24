import { CobraAuth } from './cobraAuth';
import { RetryRunner, TransientError, isTransientStatus } from '../utils/retry';

// Thin OData/JSON HTTP layer for Cobra. Handles bearer auth, retry on
// transient faults, and a one-shot token refresh on 401.
export type CobraHttp = {
  get: <T>(path: string) => Promise<T>;
  getList: <T>(path: string) => Promise<T[]>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  patch: (path: string, body: unknown) => Promise<void>;
  del: (path: string) => Promise<void>;
};

export const createCobraHttp = (
  cfg: { baseUrl: string },
  auth: CobraAuth,
  retry: RetryRunner,
): CobraHttp => {
  // Single request attempt. Throws TransientError on 429/5xx so the retry
  // runner can back off; throws a plain Error on other non-ok responses.
  const send = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> => {
    const fire = async (token: string): Promise<Response> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      const init: RequestInit = { method, headers };
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      return fetch(`${cfg.baseUrl}${path}`, init);
    };

    let res = await fire(await auth.getToken());

    // A 401 means the token went stale: invalidate and retry ONCE with a
    // fresh token. This is outside the transient-retry budget.
    if (res.status === 401) {
      auth.invalidate();
      res = await fire(await auth.getToken());
    }

    if (isTransientStatus(res.status)) {
      throw new TransientError(
        `Cobra ${method} ${path} transient ${res.status}: ${await res.text()}`,
        res.status,
      );
    }
    if (!res.ok) {
      throw new Error(`Cobra ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res;
  };

  return {
    get: <T>(path: string) =>
      retry(async () => (await send('GET', path)).json() as Promise<T>),

    getList: <T>(path: string) =>
      retry(async () => {
        const data = (await (await send('GET', path)).json()) as
          | { value: T[] }
          | T[];
        // OData collection responses wrap rows in `value`; fall back to a raw array.
        return Array.isArray(data) ? data : data.value;
      }),

    post: <T>(path: string, body: unknown) =>
      retry(async () => (await send('POST', path, body)).json() as Promise<T>),

    patch: (path: string, body: unknown) =>
      retry(async () => {
        await send('PATCH', path, body);
      }),

    del: (path: string) =>
      retry(async () => {
        await send('DELETE', path);
      }),
  };
};
