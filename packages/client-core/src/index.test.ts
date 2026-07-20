import { describe, expect, it } from "vitest";
import {
  createSyncClient,
  type HttpTransport,
  type SyncClient,
  type SyncStore,
  syncOnce,
  type TransportRequest,
  type TransportResponse,
} from "./index";

class FakeTransport implements HttpTransport {
  readonly requests: TransportRequest[] = [];
  constructor(private readonly responses: TransportResponse[]) {}

  async send(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error("No fake response configured");
    return response;
  }
}

const retry = {
  random: () => 0,
  sleep: async () => undefined,
};

describe("createSyncClient", () => {
  it("injects authentication without coupling core to cookies", async () => {
    const transport = new FakeTransport([{ status: 200, body: { ok: true, version: "v1" } }]);
    const client = createSyncClient({
      transport,
      retry,
      authHeaders: async () => ({ Cookie: "session=opaque" }),
    });

    await client.health();

    expect(transport.requests[0]?.headers.Cookie).toBe("session=opaque");
  });

  it("retries bounded transient failures", async () => {
    const transport = new FakeTransport([
      {
        status: 503,
        body: {
          error: { code: "INTERNAL_ERROR", message: "temporary", retryable: true },
        },
      },
      { status: 200, body: { ok: true, version: "v1" } },
    ]);
    const delays: number[] = [];
    const client = createSyncClient({
      transport,
      retry: { random: () => 0, sleep: async (delay) => void delays.push(delay) },
    });

    await expect(client.health()).resolves.toEqual({ ok: true, version: "v1" });
    expect(transport.requests).toHaveLength(2);
    expect(delays).toEqual([125]);
  });

  it("rejects invalid input before transport", async () => {
    const transport = new FakeTransport([]);
    const client = createSyncClient({ transport, retry });

    await expect(
      client.push({
        mutations: [
          {
            mutationId: "bad space",
            collection: "notes",
            recordId: "one",
            baseRevision: 0,
            operation: "delete",
          },
        ],
      }),
    ).rejects.toThrow();
    expect(transport.requests).toHaveLength(0);
  });
});

describe("syncOnce", () => {
  it("pushes pending work before pulling bounded cursor pages", async () => {
    const calls: string[] = [];
    let cursor = 0;
    const store: SyncStore = {
      async getPendingMutations() {
        calls.push("pending");
        return [
          {
            mutationId: "create-one",
            collection: "notes",
            recordId: "one",
            operation: "put",
            baseRevision: 0,
            payload: { title: "local" },
          },
        ];
      },
      async applyPushResults() {
        calls.push("apply-push");
      },
      async getPullCursor() {
        calls.push("cursor");
        return cursor;
      },
      async applyPulledChanges(_changes, nextCursor) {
        calls.push(`apply-pull-${nextCursor}`);
        cursor = nextCursor;
      },
    };
    let pullCount = 0;
    const client: SyncClient = {
      health: async () => ({ ok: true, version: "v1" }),
      account: async () => ({
        user: { id: "one", name: "One", email: null, emailIsPlaceholder: true, image: null },
        providers: [],
      }),
      deleteAccount: async () => undefined,
      async push() {
        calls.push("push");
        return {
          results: [
            {
              mutationId: "create-one",
              status: "accepted",
              replayed: false,
              record: {
                collection: "notes",
                recordId: "one",
                revision: 1,
                cursor: 1,
                deleted: false,
                payload: { title: "local" },
                updatedAt: "2026-07-20T00:00:00.000Z",
              },
            },
          ],
        };
      },
      async pull() {
        calls.push("pull");
        pullCount += 1;
        return pullCount === 1
          ? { changes: [], nextCursor: 1, hasMore: true }
          : { changes: [], nextCursor: 1, hasMore: false };
      },
    };

    await expect(syncOnce(client, store)).resolves.toEqual({
      pushed: 1,
      accepted: 1,
      conflicts: 0,
      pulled: 0,
      pages: 2,
      nextCursor: 1,
      hasMore: false,
    });
    expect(calls).toEqual([
      "pending",
      "push",
      "apply-push",
      "cursor",
      "pull",
      "apply-pull-1",
      "pull",
      "apply-pull-1",
    ]);
  });
});
