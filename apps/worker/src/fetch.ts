export const OUTBOUND_FETCH_TIMEOUT_MILLISECONDS = 10_000;

export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMilliseconds = OUTBOUND_FETCH_TIMEOUT_MILLISECONDS,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
): Promise<Response> {
  return fetchImplementation(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
}
