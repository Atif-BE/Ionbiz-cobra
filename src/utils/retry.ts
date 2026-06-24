// Transient-fault retry with exponential backoff + jitter.
// Only TransientError is retried; everything else throws immediately.

export class TransientError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'TransientError';
    this.status = status;
  }
}

export type RetryRunner = <T>(fn: () => Promise<T>) => Promise<T>;

// 429 (rate limit) and any 5xx are considered transient.
export const isTransientStatus = (status: number): boolean =>
  status === 429 || (status >= 500 && status <= 599);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const createRetry = (cfg?: { budgetMs?: number }): RetryRunner => {
  const budgetMs = cfg?.budgetMs ?? 10_000;

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    let attempt = 0;

    for (;;) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof TransientError)) throw err;

        // Exponential backoff (250ms base) capped at 2s, plus full jitter.
        const base = Math.min(250 * 2 ** attempt, 2_000);
        const delay = Math.random() * base;
        attempt += 1;

        // Stop if the next sleep would push us past the budget.
        if (Date.now() - start + delay >= budgetMs) throw err;
        await sleep(delay);
      }
    }
  };
};
