/** Coalesce focus/poll reads; a completed mutation can require a fresh successor. */
export function createRefreshQueue(load: () => Promise<void>) {
  let current: Promise<void> | null = null;
  function refresh(afterCurrent = false): Promise<void> {
    if (current) {
      return afterCurrent ? current.then(() => refresh(), () => refresh()) : current;
    }
    current = Promise.resolve().then(load).finally(() => { current = null; });
    return current;
  }
  return refresh;
}
