import { env } from "cloudflare:workers";
import { LIMITS, type PullResponse, type PushResponse } from "@cloudflare-mobile-sync/api-contract";
import { describe, expect, it, vi } from "vitest";
import { type AuthenticatedUser, deleteAccountData } from "../src/account";
import { createApp } from "../src/app";
import {
  createAuth,
  parseVersionedSecrets,
  validateAuthSecrets,
  validateTrustedOrigins,
} from "../src/auth";
import { fetchWithTimeout } from "../src/fetch";

interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

async function authenticate(request: Request): Promise<AuthenticatedUser | null> {
  const id = request.headers.get("X-Test-User");
  if (!id) return null;
  const user = await env.DB.prepare(`SELECT id, name, email, image FROM user WHERE id = ?`)
    .bind(id)
    .first<UserRow>();
  if (!user) return null;
  const ageHours = Number(request.headers.get("X-Test-Session-Age-Hours") ?? 0);
  return {
    ...user,
    sessionCreatedAt: new Date(Date.now() - ageHours * 60 * 60 * 1_000),
  };
}

const app = createApp({
  authenticate,
  async deleteAccount(_request, requestEnv, user) {
    await requestEnv.DB.prepare(`DELETE FROM user WHERE id = ?`).bind(user.id).run();
  },
});

async function seedUser(id: string, email = `${id}@example.test`): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, NULL, ?, ?)`,
  )
    .bind(id, id, email, now, now)
    .run();
}

async function apiRequest(
  path: string,
  options: RequestInit = {},
  userId?: string,
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (userId) headers.set("X-Test-User", userId);
  return app.request(`https://sync.example.test${path}`, { ...options, headers }, env);
}

async function push(userId: string, mutations: unknown[]): Promise<Response> {
  return apiRequest(
    "/v1/sync/push",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mutations }),
    },
    userId,
  );
}

describe("Worker API", () => {
  it("validates the optional Better Auth rotation keyring", () => {
    expect(
      parseVersionedSecrets(
        "2:abcdefghijklmnopqrstuvwxyz0123456789,1:0123456789abcdefghijklmnopqrstuvwxyz",
      ),
    ).toEqual([
      { version: 2, value: "abcdefghijklmnopqrstuvwxyz0123456789" },
      { version: 1, value: "0123456789abcdefghijklmnopqrstuvwxyz" },
    ]);
    expect(() => parseVersionedSecrets("1:short")).toThrow();
    expect(() =>
      parseVersionedSecrets(
        "1:abcdefghijklmnopqrstuvwxyz0123456789,1:0123456789abcdefghijklmnopqrstuvwxyz",
      ),
    ).toThrow();
    expect(() =>
      validateAuthSecrets({
        BETTER_AUTH_SECRET: "replace-with-at-least-32-random-bytes",
        BETTER_AUTH_SECRETS: "1:replace-with-at-least-32-random-bytes",
      }),
    ).toThrow("placeholder");
    expect(() =>
      validateAuthSecrets({
        BETTER_AUTH_SECRET: "too-short",
        BETTER_AUTH_SECRETS: "1:0123456789abcdefghijklmnopqrstuvwxyz",
      }),
    ).toThrow("32+ bytes");
  });

  it("requires collision-resistant mobile origins", () => {
    expect(() => validateTrustedOrigins({ TRUSTED_ORIGINS: "my-app://" })).toThrow(
      "reverse-domain",
    );
    expect(
      validateTrustedOrigins({
        TRUSTED_ORIGINS: "com.example.myapp://,https://app.example.com",
      }),
    ).toEqual(["com.example.myapp://", "https://app.example.com"]);
  });

  it("does not persist attacker-controlled auth rate-limit keys in D1", async () => {
    const before = await env.DB.prepare(`SELECT COUNT(*) AS count FROM rateLimit`).first<number>(
      "count",
    );
    const auth = createAuth({
      ...env,
      BETTER_AUTH_SECRET: "0123456789abcdefghijklmnopqrstuvwxyz",
      BETTER_AUTH_SECRETS: "1:0123456789abcdefghijklmnopqrstuvwxyz",
    });

    await auth.handler(
      new Request(`https://sync.example.test/v1/auth/attacker-controlled-${crypto.randomUUID()}`),
    );

    const after = await env.DB.prepare(`SELECT COUNT(*) AS count FROM rateLimit`).first<number>(
      "count",
    );
    expect(after).toBe(before);
  });

  it("aborts a stalled provider request at its timeout", async () => {
    const stalledFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })) as typeof globalThis.fetch;

    await expect(
      fetchWithTimeout("https://provider.example.test", {}, 5, stalledFetch),
    ).rejects.toThrow("timeout");
  });

  it("reports health and requires authentication for application data", async () => {
    const health = await apiRequest("/health", { headers: { "CF-Ray": "test-ray" } });
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, version: "v1" });
    expect(health.headers.get("X-Request-ID")).toBe("test-ray");

    const unauthorized = await apiRequest("/v1/sync/pull");
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required",
        retryable: false,
      },
    });
  });

  it("logs an opaque unexpected error without leaking its message", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingApp = createApp({
      authenticate: async () => {
        throw new Error("cookie=session-secret");
      },
    });

    try {
      const response = await failingApp.request("https://sync.example.test/v1/sync/pull", {}, env);

      expect(response.status).toBe(500);
      expect(response.headers.get("X-Request-ID")).toBeTruthy();
      expect(errorLog).toHaveBeenCalledOnce();
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain("session-secret");
    } finally {
      errorLog.mockRestore();
    }
  });

  it("applies CAS mutations atomically, replays idempotently, and pages changes", async () => {
    await seedUser("alice");
    await seedUser("bob");

    const create = await push("alice", [
      {
        mutationId: "alice-create",
        collection: "notes",
        recordId: "note-1",
        operation: "put",
        baseRevision: 0,
        payload: { title: "first" },
      },
    ]);
    expect(create.status).toBe(200);
    const created = (await create.json()) as PushResponse;
    expect(created.results[0]).toMatchObject({
      mutationId: "alice-create",
      status: "accepted",
      replayed: false,
      record: { revision: 1, deleted: false, payload: { title: "first" } },
    });

    const replay = await push("alice", [
      {
        mutationId: "alice-create",
        collection: "notes",
        recordId: "note-1",
        operation: "put",
        baseRevision: 0,
        payload: { title: "different retry body" },
      },
    ]);
    expect((await replay.json()) as PushResponse).toMatchObject({
      results: [
        {
          mutationId: "alice-create",
          status: "accepted",
          replayed: true,
          record: { revision: 1, payload: { title: "first" } },
        },
      ],
    });

    const stale = await push("alice", [
      {
        mutationId: "alice-stale",
        collection: "notes",
        recordId: "note-1",
        operation: "put",
        baseRevision: 0,
        payload: { title: "stale" },
      },
    ]);
    expect((await stale.json()) as PushResponse).toMatchObject({
      results: [
        {
          status: "conflict",
          replayed: false,
          current: { revision: 1, payload: { title: "first" } },
        },
      ],
    });

    const update = await push("alice", [
      {
        mutationId: "alice-update",
        collection: "notes",
        recordId: "note-1",
        operation: "put",
        baseRevision: 1,
        payload: { title: "second" },
      },
      {
        mutationId: "alice-delete",
        collection: "notes",
        recordId: "note-1",
        operation: "delete",
        baseRevision: 2,
      },
    ]);
    const updated = (await update.json()) as PushResponse;
    expect(updated.results).toMatchObject([
      { status: "accepted", record: { revision: 2, deleted: false } },
      { status: "accepted", record: { revision: 3, deleted: true, payload: null } },
    ]);

    const firstPage = await apiRequest("/v1/sync/pull?cursor=0&limit=2", {}, "alice");
    const firstPull = (await firstPage.json()) as PullResponse;
    expect(firstPull.changes).toHaveLength(2);
    expect(firstPull.hasMore).toBe(true);
    const secondPage = await apiRequest(
      `/v1/sync/pull?cursor=${firstPull.nextCursor}&limit=2`,
      {},
      "alice",
    );
    const secondPull = (await secondPage.json()) as PullResponse;
    expect(secondPull.changes).toMatchObject([{ revision: 3, deleted: true }]);
    expect(secondPull.hasMore).toBe(false);

    const bobPull = await apiRequest("/v1/sync/pull?cursor=0", {}, "bob");
    expect(await bobPull.json()).toEqual({ changes: [], nextCursor: 0, hasMore: false });
    const bobConflict = await push("bob", [
      {
        mutationId: "bob-stale",
        collection: "notes",
        recordId: "note-1",
        operation: "put",
        baseRevision: 3,
        payload: { title: "forged revision" },
      },
    ]);
    expect((await bobConflict.json()) as PushResponse).toMatchObject({
      results: [{ status: "conflict", current: null }],
    });
    const bobDelete = await push("bob", [
      {
        mutationId: "bob-delete",
        collection: "notes",
        recordId: "note-1",
        operation: "delete",
        baseRevision: 3,
      },
    ]);
    expect((await bobDelete.json()) as PushResponse).toMatchObject({
      results: [{ status: "conflict", current: null }],
    });
  });

  it("accepts only one of two concurrent updates from the same base revision", async () => {
    await seedUser("concurrent-user");
    await push("concurrent-user", [
      {
        mutationId: "concurrent-create",
        collection: "notes",
        recordId: "shared-note",
        operation: "put",
        baseRevision: 0,
        payload: { value: "initial" },
      },
    ]);

    const [left, right] = await Promise.all([
      push("concurrent-user", [
        {
          mutationId: "concurrent-left",
          collection: "notes",
          recordId: "shared-note",
          operation: "put",
          baseRevision: 1,
          payload: { value: "left" },
        },
      ]),
      push("concurrent-user", [
        {
          mutationId: "concurrent-right",
          collection: "notes",
          recordId: "shared-note",
          operation: "put",
          baseRevision: 1,
          payload: { value: "right" },
        },
      ]),
    ]);
    const results = [
      ((await left.json()) as PushResponse).results[0],
      ((await right.json()) as PushResponse).results[0],
    ];

    expect(results.filter((result) => result?.status === "accepted")).toHaveLength(1);
    expect(results.filter((result) => result?.status === "conflict")).toHaveLength(1);
    expect(
      results.every((result) => result?.status === "accepted" || result?.current?.revision === 2),
    ).toBe(true);
  });

  it("accepts a full 25-mutation push without exceeding the D1 query budget", async () => {
    await seedUser("full-batch-user");
    const response = await push(
      "full-batch-user",
      Array.from({ length: 25 }, (_, index) => ({
        mutationId: `full-batch-${index}`,
        collection: "notes",
        recordId: `full-batch-note-${index}`,
        operation: "put",
        baseRevision: 0,
        payload: { index },
      })),
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as PushResponse).results).toHaveLength(25);
  });

  it("prevents one provider identity from belonging to two local users", async () => {
    await seedUser("identity-owner");
    await seedUser("identity-attacker");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind("identity-owner-account", "same-provider-subject", "google", "identity-owner", now, now)
      .run();

    await expect(
      env.DB.prepare(
        `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "identity-attacker-account",
          "same-provider-subject",
          "google",
          "identity-attacker",
          now,
          now,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("rejects forged scope, unknown fields, and disallowed collections", async () => {
    await seedUser("mallory");
    const forged = await apiRequest(
      "/v1/sync/push",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "alice",
          mutations: [
            {
              mutationId: "forged",
              collection: "notes",
              recordId: "note-1",
              operation: "delete",
              baseRevision: 1,
            },
          ],
        }),
      },
      "mallory",
    );
    expect(forged.status).toBe(400);

    const unknownField = await push("mallory", [
      {
        mutationId: "unknown-field",
        collection: "notes",
        recordId: "note-1",
        operation: "delete",
        baseRevision: 0,
        userId: "alice",
      },
    ]);
    expect(unknownField.status).toBe(400);

    const disallowed = await push("mallory", [
      {
        mutationId: "wrong-collection",
        collection: "secrets",
        recordId: "note-1",
        operation: "delete",
        baseRevision: 0,
      },
    ]);
    expect(disallowed.status).toBe(403);

    const malformed = await apiRequest(
      "/v1/sync/push",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      },
      "mallory",
    );
    expect(malformed.status).toBe(400);

    const oversized = await apiRequest(
      "/v1/sync/push",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "x".repeat(LIMITS.requestBodyBytes + 1),
      },
      "mallory",
    );
    expect(oversized.status).toBe(413);
  });

  it("stops reading a streamed request as soon as the body limit is exceeded", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new Uint8Array(LIMITS.requestBodyBytes + 1));
          return;
        }
        throw new Error("the oversized request should have been cancelled");
      },
    });
    const request = new Request("https://sync.example.test/v1/sync/push", {
      method: "POST",
      headers: { "X-Test-User": "mallory" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await app.fetch(request, env);

    expect(response.status).toBe(413);
    expect(pulls).toBe(1);
  });

  it("hides placeholder email and deletes server data with the account", async () => {
    await seedUser("private-user", "provider.abcd@placeholder.invalid");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind("account-1", "provider-subject", "kakao", "private-user", now, now)
      .run();
    await push("private-user", [
      {
        mutationId: "private-create",
        collection: "notes",
        recordId: "private-note",
        operation: "put",
        baseRevision: 0,
        payload: { private: true },
      },
    ]);

    const account = await apiRequest("/v1/account", {}, "private-user");
    expect(await account.json()).toMatchObject({
      user: { email: null, emailIsPlaceholder: true },
      providers: [{ providerId: "kakao", accountId: "provider-subject" }],
    });

    const staleSession = await apiRequest(
      "/v1/account",
      {
        method: "DELETE",
        headers: { "X-Test-Session-Age-Hours": "25" },
      },
      "private-user",
    );
    expect(staleSession.status).toBe(401);

    const deletion = await apiRequest("/v1/account", { method: "DELETE" }, "private-user");
    expect(deletion.status).toBe(204);
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM user WHERE id = ?`)
        .bind("private-user")
        .first("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM sync_records WHERE user_id = ?`)
        .bind("private-user")
        .first("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM sync_changes WHERE user_id = ?`)
        .bind("private-user")
        .first("count"),
    ).toBe(0);

    const afterDeletion = await apiRequest("/v1/sync/pull", {}, "private-user");
    expect(afterDeletion.status).toBe(401);
  });

  it("does not let a provider outage block local account deletion", async () => {
    await seedUser("provider-outage-user");
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO account (id, accountId, providerId, userId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "provider-outage-account",
        "provider-subject",
        "google",
        "provider-outage-user",
        now,
        now,
      )
      .run();
    await push("provider-outage-user", [
      {
        mutationId: "provider-outage-create",
        collection: "notes",
        recordId: "private-record",
        operation: "put",
        baseRevision: 0,
        payload: { private: true },
      },
    ]);

    const outcome = await deleteAccountData(env.DB, "provider-outage-user", async () => {
      throw new Error("simulated provider outage");
    });

    expect(outcome).toEqual({ providerRevocationFailures: ["google"] });
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM user WHERE id = ?`)
        .bind("provider-outage-user")
        .first("count"),
    ).toBe(0);
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM sync_records WHERE user_id = ?`)
        .bind("provider-outage-user")
        .first("count"),
    ).toBe(0);
  });

  it("fails closed when the local account does not exist", async () => {
    await expect(deleteAccountData(env.DB, "missing-user", async () => undefined)).rejects.toThrow(
      "Account deletion did not delete a user",
    );
  });
});
