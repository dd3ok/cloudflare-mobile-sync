import { describe, expect, it } from "vitest";
import { fetchWithTimeout } from "./fetch-with-timeout";

describe("fetchWithTimeout", () => {
  it("aborts a stalled request after the configured timeout", async () => {
    let receivedSignal: AbortSignal | undefined;
    const stalledFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        receivedSignal = init?.signal ?? undefined;
        receivedSignal?.addEventListener("abort", () => reject(receivedSignal?.reason), {
          once: true,
        });
      })) as typeof globalThis.fetch;

    await expect(
      fetchWithTimeout(stalledFetch, "https://sync.example.test", {}, 5),
    ).rejects.toThrow("Request timed out");
    expect(receivedSignal?.aborted).toBe(true);
  });
});
