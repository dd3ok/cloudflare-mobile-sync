import { env } from "cloudflare:workers";
import { LIMITS, type PullResponse, type PushResponse } from "@cloudflare-mobile-sync/api-contract";
import { describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/account";
import { createApp } from "../src/app";
import { parseVersionedSecrets } from "../src/auth";

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
  });

  it("reports health and requires authentication for application data", async () => {
    const health = await apiRequest("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, version: "v1" });

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
});
