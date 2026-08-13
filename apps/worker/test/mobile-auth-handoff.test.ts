import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";

const app = createApp();
const trustedAudience = "com.byeolsata.app";
const codeChallenge = "A".repeat(43);
const sessionToken = "worker-session-token";
const signedSessionCookie = `${sessionToken}.signed-cookie-proof`;

async function prepare(audience = trustedAudience, challenge = codeChallenge): Promise<Response> {
  return app.request(
    "https://sync.example.test/v1/mobile-auth/handoffs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience, codeChallenge: challenge }),
    },
    env,
  );
}

async function s256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

describe("mobile auth handoff", () => {
  it("prepares only a short-lived handoff for an exact trusted app audience", async () => {
    const response = await prepare();

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      handoffId: expect.stringMatching(/^[A-Fa-f0-9]{64}$/u),
      expiresAt: expect.stringMatching(/Z$/u),
    });

    const untrusted = await prepare("com.attacker.app");
    expect(untrusted.status).toBe(403);
  });

  it("replaces the private-scheme bearer cookie with a one-time code", async () => {
    const userId = `handoff-user-${crypto.randomUUID()}`;
    const sessionId = `handoff-session-${crypto.randomUUID()}`;
    const now = new Date();
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    )
      .bind(userId, userId, `${userId}@example.test`, now.toISOString(), now.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO session
        (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
      .bind(
        sessionId,
        new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
        sessionToken,
        now.toISOString(),
        now.toISOString(),
        userId,
      )
      .run();

    let handoffId = "";
    const callbackApp = createApp({
      async handleAuth() {
        const location = new URL(`${trustedAudience}://auth/callback`);
        location.searchParams.set("mobile_handoff", handoffId);
        location.searchParams.set(
          "cookie",
          `better-auth.session_token=${signedSessionCookie}; Path=/; HttpOnly; Secure`,
        );
        location.searchParams.set("access_token", "provider-access-token");
        location.searchParams.set("token", "provider-token");
        location.searchParams.set("unknown", "provider-extra");
        location.hash = "code=provider-fragment-code";
        return new Response(null, {
          status: 302,
          headers: {
            Location: location.toString(),
            "Set-Cookie": `better-auth.session_token=${signedSessionCookie}; Path=/; HttpOnly; Secure`,
          },
        });
      },
    });
    const prepared = await callbackApp.request(
      "https://sync.example.test/v1/mobile-auth/handoffs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: trustedAudience, codeChallenge }),
      },
      env,
    );
    handoffId = ((await prepared.json()) as { handoffId: string }).handoffId;

    const response = await callbackApp.request(
      "https://sync.example.test/v1/auth/callback/google?code=provider-code&state=provider-state",
      {},
      env,
    );
    const location = new URL(response.headers.get("Location") ?? "");

    expect(response.status).toBe(302);
    expect(location.protocol).toBe(`${trustedAudience}:`);
    expect(location.host).toBe("auth");
    expect(location.pathname).toBe("/callback");
    expect(location.searchParams.get("mobile_handoff")).toBe(handoffId);
    expect(location.searchParams.get("code")).toMatch(/^[A-Fa-f0-9]{64}$/u);
    expect(location.searchParams.has("cookie")).toBe(false);
    expect([...location.searchParams.keys()].sort()).toEqual(["code", "mobile_handoff"]);
    expect(location.hash).toBe("");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.get("Location")).not.toContain(signedSessionCookie);
  });

  it("removes bearer cookies from legacy private-scheme callbacks and fails closed", async () => {
    const legacyApp = createApp({
      async handleAuth() {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${trustedAudience}://auth/callback?cookie=${encodeURIComponent(
              `better-auth.session_token=${signedSessionCookie}`,
            )}`,
            "Set-Cookie": `better-auth.session_token=${signedSessionCookie}; Path=/; HttpOnly; Secure`,
          },
        });
      },
    });

    const response = await legacyApp.request(
      "https://sync.example.test/v1/auth/callback/google",
      {},
      env,
    );
    const location = new URL(response.headers.get("Location") ?? "");

    expect(location.searchParams.has("cookie")).toBe(false);
    expect(location.searchParams.get("error")).toBe("mobile_handoff_required");
    expect(response.headers.has("Set-Cookie")).toBe(false);
    expect(response.headers.get("Location")).not.toContain(signedSessionCookie);
  });

  it("binds HTTPS exchange to verifier and audience and allows exactly one success", async () => {
    const verifier = "v".repeat(64);
    const challenge = await s256(verifier);
    const rawToken = `exchange-token-${crypto.randomUUID()}`;
    const signedCookie = `${rawToken}.signed-cookie-proof`;
    const userId = `exchange-user-${crypto.randomUUID()}`;
    const sessionId = `exchange-session-${crypto.randomUUID()}`;
    const now = new Date();
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    )
      .bind(userId, userId, `${userId}@example.test`, now.toISOString(), now.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO session
        (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
      .bind(
        sessionId,
        new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
        rawToken,
        now.toISOString(),
        now.toISOString(),
        userId,
      )
      .run();

    let handoffId = "";
    const exchangeApp = createApp({
      async handleAuth() {
        const location = new URL(`${trustedAudience}://auth/callback`);
        location.searchParams.set("mobile_handoff", handoffId);
        location.searchParams.set(
          "cookie",
          `better-auth.session_token=${signedCookie}; Path=/; HttpOnly; Secure`,
        );
        return new Response(null, { status: 302, headers: { Location: location.toString() } });
      },
    });
    const prepared = await exchangeApp.request(
      "https://sync.example.test/v1/mobile-auth/handoffs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: trustedAudience, codeChallenge: challenge }),
      },
      env,
    );
    handoffId = ((await prepared.json()) as { handoffId: string }).handoffId;
    const callback = await exchangeApp.request(
      "https://sync.example.test/v1/auth/callback/google",
      {},
      env,
    );
    const code = new URL(callback.headers.get("Location") ?? "").searchParams.get("code");
    expect(code).toMatch(/^[A-Fa-f0-9]{64}$/u);
    const readySession = await env.DB.prepare(`SELECT expiresAt FROM session WHERE id = ?`)
      .bind(sessionId)
      .first<{ expiresAt: string }>();
    expect(new Date(readySession?.expiresAt ?? 0).getTime()).toBeLessThanOrEqual(
      Date.now() + 60 * 1_000,
    );

    async function exchange(
      candidateVerifier: string,
      audience = trustedAudience,
    ): Promise<Response> {
      return exchangeApp.request(
        "https://sync.example.test/v1/mobile-auth/handoffs/exchange",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ handoffId, code, verifier: candidateVerifier, audience }),
        },
        env,
      );
    }

    const wrongAudience = await exchange(verifier, "com.byeolsata.app.preview");
    expect(wrongAudience.status).toBe(401);
    expect(await wrongAudience.text()).not.toContain(signedCookie);

    const wrongVerifier = await exchange("x".repeat(64));
    expect(wrongVerifier.status).toBe(401);
    expect(await wrongVerifier.text()).not.toContain(signedCookie);

    const accepted = await exchange(verifier);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("Cache-Control")).toBe("no-store");
    expect(await accepted.json()).toMatchObject({
      sessionCookie: expect.stringContaining(signedCookie),
      userId,
      expiresAt: expect.stringMatching(/Z$/u),
    });
    const exchangedSession = await env.DB.prepare(`SELECT expiresAt FROM session WHERE id = ?`)
      .bind(sessionId)
      .first<{ expiresAt: string }>();
    expect(new Date(exchangedSession?.expiresAt ?? 0).getTime()).toBeGreaterThan(
      Date.now() + 50 * 60 * 1_000,
    );

    const replay = await exchange(verifier);
    expect(replay.status).toBe(401);
    expect(await replay.text()).not.toContain(signedCookie);
    expect(
      await env.DB.prepare(`SELECT id FROM session WHERE id = ?`).bind(sessionId).first(),
    ).not.toBeNull();
    expect(
      await env.DB.prepare(
        `SELECT consumed_at, session_cookie, code_hash
         FROM mobile_auth_handoff WHERE id = ? AND consumed_at IS NOT NULL`,
      )
        .bind(handoffId)
        .first(),
    ).toMatchObject({
      session_cookie: null,
      code_hash: null,
    });
    await env.DB.prepare(`UPDATE mobile_auth_handoff SET expires_at = ? WHERE id = ?`)
      .bind(Date.now() - 1, handoffId)
      .run();
    await prepare();
    expect(
      await env.DB.prepare(`SELECT id FROM session WHERE id = ?`).bind(sessionId).first(),
    ).not.toBeNull();
  });

  it("revokes a ready session that expires without an exchange", async () => {
    const userId = `expired-ready-user-${crypto.randomUUID()}`;
    const sessionId = `expired-ready-session-${crypto.randomUUID()}`;
    const token = `expired-ready-token-${crypto.randomUUID()}`;
    const now = new Date();
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    )
      .bind(userId, userId, `${userId}@example.test`, now.toISOString(), now.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO session
        (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
      .bind(
        sessionId,
        new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
        token,
        now.toISOString(),
        now.toISOString(),
        userId,
      )
      .run();
    let handoffId = "";
    const expiryApp = createApp({
      async handleAuth() {
        const location = new URL(`${trustedAudience}://auth/callback`);
        location.searchParams.set("mobile_handoff", handoffId);
        location.searchParams.set(
          "cookie",
          `better-auth.session_token=${token}.signed-cookie-proof; Path=/; HttpOnly; Secure`,
        );
        return new Response(null, { status: 302, headers: { Location: location.toString() } });
      },
    });
    const prepared = await prepare();
    handoffId = ((await prepared.json()) as { handoffId: string }).handoffId;
    await env.DB.prepare(`DELETE FROM mobile_auth_handoff WHERE id = ?`).bind(handoffId).run();
    const preparedForExpiry = await expiryApp.request(
      "https://sync.example.test/v1/mobile-auth/handoffs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: trustedAudience, codeChallenge }),
      },
      env,
    );
    handoffId = ((await preparedForExpiry.json()) as { handoffId: string }).handoffId;
    await expiryApp.request("https://sync.example.test/v1/auth/callback/google", {}, env);
    await env.DB.prepare(`UPDATE mobile_auth_handoff SET expires_at = ? WHERE id = ?`)
      .bind(Date.now() - 1, handoffId)
      .run();

    await prepare();

    expect(
      await env.DB.prepare(`SELECT id FROM session WHERE id = ?`).bind(sessionId).first(),
    ).toBeNull();
    expect(
      await env.DB.prepare(`SELECT id FROM mobile_auth_handoff WHERE id = ?`)
        .bind(handoffId)
        .first(),
    ).toBeNull();
  });

  it("rate limits prepare before parsing and still enforces the request body bound", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const denied = await app.request(
      "https://sync.example.test/v1/mobile-auth/handoffs",
      { method: "POST", body: "not-json" },
      { ...env, AUTH_RATE_LIMITER: { limit } },
    );
    expect(denied.status).toBe(429);
    expect(limit).toHaveBeenCalledOnce();

    const allowedLimit = vi.fn(async () => ({ success: true }));
    const oversized = await app.request(
      "https://sync.example.test/v1/mobile-auth/handoffs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filler: "x".repeat(256 * 1_024) }),
      },
      { ...env, AUTH_RATE_LIMITER: { limit: allowedLimit } },
    );
    expect(oversized.status).toBe(413);
    expect(allowedLimit).toHaveBeenCalledOnce();
  });

  it("lets only the verifier-bound initiating app cancel a ready or exchanged handoff", async () => {
    const verifier = "c".repeat(64);
    const challenge = await s256(verifier);
    const token = `cancel-token-${crypto.randomUUID()}`;
    const userId = `cancel-user-${crypto.randomUUID()}`;
    const sessionId = `cancel-session-${crypto.randomUUID()}`;
    const now = new Date();
    await env.DB.prepare(
      `INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt)
       VALUES (?, ?, ?, 1, NULL, ?, ?)`,
    )
      .bind(userId, userId, `${userId}@example.test`, now.toISOString(), now.toISOString())
      .run();
    await env.DB.prepare(
      `INSERT INTO session
        (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
    )
      .bind(
        sessionId,
        new Date(now.getTime() + 60 * 60 * 1_000).toISOString(),
        token,
        now.toISOString(),
        now.toISOString(),
        userId,
      )
      .run();

    let handoffId = "";
    const cancelApp = createApp({
      async handleAuth() {
        const location = new URL(`${trustedAudience}://auth/callback`);
        location.searchParams.set("mobile_handoff", handoffId);
        location.searchParams.set(
          "cookie",
          `better-auth.session_token=${token}.signed-cookie-proof; Path=/; HttpOnly; Secure`,
        );
        return new Response(null, { status: 302, headers: { Location: location.toString() } });
      },
    });
    const prepared = await cancelApp.request(
      "https://sync.example.test/v1/mobile-auth/handoffs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: trustedAudience, codeChallenge: challenge }),
      },
      env,
    );
    handoffId = ((await prepared.json()) as { handoffId: string }).handoffId;
    await cancelApp.request("https://sync.example.test/v1/auth/callback/google", {}, env);
    await env.DB.prepare(
      `UPDATE mobile_auth_handoff
       SET consumed_at = ?, code_hash = NULL, session_cookie = NULL
       WHERE id = ?`,
    )
      .bind(Date.now(), handoffId)
      .run();

    async function cancel(candidateVerifier: string): Promise<Response> {
      return cancelApp.request(
        "https://sync.example.test/v1/mobile-auth/handoffs/cancel",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audience: trustedAudience,
            handoffId,
            verifier: candidateVerifier,
          }),
        },
        env,
      );
    }

    expect((await cancel("x".repeat(64))).status).toBe(401);
    expect(
      await env.DB.prepare(`SELECT id FROM session WHERE id = ?`).bind(sessionId).first(),
    ).not.toBeNull();

    const acceptedCancellation = await cancel(verifier);
    expect(acceptedCancellation.status, await acceptedCancellation.text()).toBe(204);
    expect(
      await env.DB.prepare(`SELECT id FROM session WHERE id = ?`).bind(sessionId).first(),
    ).toBeNull();
  });
});
