const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_RPC_TIMEOUT_MS = 15_000;

/**
 * Execute a fetch with a default timeout to avoid indefinitely hung upstream
 * HTTP requests tying up MCP sessions.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (!init?.signal) {
    return fetch(input, { ...init, signal: timeoutSignal });
  }

  if (typeof AbortSignal.any === "function") {
    return fetch(input, {
      ...init,
      signal: AbortSignal.any([init.signal, timeoutSignal]),
    });
  }

  return fetch(input, { ...init, signal: timeoutSignal });
}

export async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  timeoutMessage = `Operation timed out after ${timeoutMs}ms`,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export { DEFAULT_FETCH_TIMEOUT_MS, DEFAULT_RPC_TIMEOUT_MS };
