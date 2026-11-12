/** Share one in-flight refresh among simultaneous API requests. No mutation retries. */
export function singleFlight<T>() {
  let running: Promise<T> | null = null;
  return (operation: () => Promise<T>): Promise<T> => {
    if (!running) {
      running = Promise.resolve().then(operation).finally(() => { running = null; });
    }
    return running;
  };
}
