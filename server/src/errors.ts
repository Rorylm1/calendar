export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export class ProviderError extends Error {
  constructor(public status: number, public reconnect = false, public retryable = !reconnect && (status === 0 || status === 408 || status === 429 || status >= 500), public retryAfterMs = 0, public rateLimitReason?: 'rateLimitExceeded' | 'userRateLimitExceeded') { super('Provider request failed'); }
}
export class ProcessingPaused extends Error {
  constructor(public reason: 'paused_missing_key' | 'paused_budget') { super(reason); }
}
export function safeError(error: unknown): string {
  if (error instanceof ProviderError && error.reconnect) return 'Gmail needs reconnecting. Your saved calendar is unchanged.';
  if (error instanceof ProviderError && (error.rateLimitReason || error.status === 429)) return 'Gmail is limiting this import. Saved progress is safe and will resume on the next check.';
  if (error instanceof ProviderError && error.retryable) return 'Gmail could not be reached reliably after three attempts. Saved progress will resume on the next check.';
  if (error instanceof ProcessingPaused) return error.reason === 'paused_budget' ? 'Email interpretation is paused at the monthly AI budget. Captured messages are retained.' : 'Add the model API key to interpret captured email.';
  return 'The check could not finish. Captured work is saved and will retry on the next check.';
}
