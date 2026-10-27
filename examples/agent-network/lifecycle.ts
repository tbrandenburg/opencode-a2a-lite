export type Release = () => Promise<void>;

export function owned(release: Release, signal?: AbortSignal): Release {
  let closing: Promise<void> | undefined;
  const close = () => {
    signal?.removeEventListener("abort", interrupt);
    closing ??= Promise.resolve().then(release);
    return closing;
  };
  const interrupt = () => {
    // Retain the rejection for the explicit cleanup path, without an unhandled promise.
    void close().catch(() => undefined);
  };
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  return close;
}

export async function interrupted<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  let interrupt: () => void = () => undefined;
  const aborted = new Promise<never>((_done, fail) => {
    interrupt = () => fail(new Error("Network experiment interrupted"));
    signal.addEventListener("abort", interrupt, { once: true });
    if (signal.aborted) interrupt();
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", interrupt);
  }
}

export function createLifecycle() {
  const controller = new AbortController();
  const releases: Release[] = [];
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  return {
    signal: controller.signal,
    releases,
    async drain() {
      const failures: string[] = [];
      try {
        while (releases.length) {
          try {
            await releases.pop()!();
          } catch {
            failures.push("Owned-resource cleanup failed");
          }
        }
      } finally {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
      }
      return failures;
    },
  };
}
