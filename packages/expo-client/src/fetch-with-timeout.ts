import type { CancellationSignal } from "@cloudflare-mobile-sync/client-core";

export async function fetchWithTimeout(
  fetchImplementation: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMilliseconds: number,
  externalSignal?: CancellationSignal,
): Promise<Response> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener?.("abort", abortFromCaller, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMilliseconds,
  );

  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener?.("abort", abortFromCaller);
  }
}
