/** One admission operation per operator acknowledgement, including after a failed request.
 * A retry is never automatic: a dropped response may already have changed server state.
 */
export function createScanSession() {
  let state: 'ready' | 'running' | 'finished' = 'ready';
  return {
    async submit<T>(operation: () => Promise<T>): Promise<{ accepted: false } | { accepted: true; result: T }> {
      if (state !== 'ready') return { accepted: false };
      state = 'running';
      try {
        return { accepted: true, result: await operation() };
      } finally {
        state = 'finished';
      }
    },
    reset() {
      if (state === 'running') return false;
      state = 'ready';
      return true;
    },
    getState() { return state; },
  };
}
