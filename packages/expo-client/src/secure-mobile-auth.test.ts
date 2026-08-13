import { describe, expect, it, vi } from "vitest";
import { createSecureMobileAuthAdapter } from "./secure-mobile-auth";

const audience = "com.example.mobile";
const handoffId = "1".repeat(64);
const code = "2".repeat(64);
const verifier = "v".repeat(64);
const sessionCookie =
  "better-auth.session_token=server-session.signed-proof; Path=/; HttpOnly; Secure";
const createCallbackUrl = (callbackPath: string, preparedHandoffId: string) =>
  `${audience}:///${callbackPath}?mobile_handoff=${preparedHandoffId}`;

describe("secure mobile auth adapter", () => {
  it("clears the local session cookie without a network request", async () => {
    const fetch = vi.fn();
    const clearSessionCookie = vi.fn(async () => undefined);
    const adapter = createSecureMobileAuthAdapter({
      audience,
      baseUrl: "https://sync.example.test",
      fetch,
      generateVerifier: async () => verifier,
      challenge: async () => "A".repeat(43),
      createCallbackUrl,
      beginGoogleSignIn: async () => "https://accounts.google.test/authorize",
      openAuthSession: async () => ({ type: "cancel" }),
      storeSessionCookie: vi.fn(),
      clearSessionCookie,
    });

    await adapter.clearLocalSession();

    expect(clearSessionCookie).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stores a session only after a verifier-bound HTTPS exchange", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      requests.push({ url, body });
      if (url.endsWith("/v1/mobile-auth/handoffs")) {
        return Response.json({ handoffId, expiresAt: "2099-01-01T00:00:00.000Z" }, { status: 201 });
      }
      if (url.endsWith("/v1/mobile-auth/handoffs/exchange")) {
        return Response.json({
          sessionCookie,
          userId: "account-a",
          expiresAt: "2099-01-01T01:00:00.000Z",
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    let storedCookie = "";
    const adapter = createSecureMobileAuthAdapter({
      audience,
      baseUrl: "https://sync.example.test",
      fetch,
      generateVerifier: async () => verifier,
      challenge: async () => "A".repeat(43),
      createCallbackUrl,
      beginGoogleSignIn: async (callbackUrl) => {
        expect(callbackUrl).toBe(`${audience}:///settings?mobile_handoff=${handoffId}`);
        return "https://accounts.google.test/authorize";
      },
      openAuthSession: async (authorizationUrl, callbackUrl) => {
        expect(authorizationUrl).toBe("https://accounts.google.test/authorize");
        expect(callbackUrl).toBe(`${audience}:///settings?mobile_handoff=${handoffId}`);
        return { type: "success", url: `${callbackUrl}&code=${code}` };
      },
      storeSessionCookie: async (cookie) => {
        storedCookie = cookie;
      },
    });

    const result = await adapter.signInWithGoogle({ callbackPath: "settings" });

    expect(result).toEqual({ userId: "account-a", expiresAt: "2099-01-01T01:00:00.000Z" });
    expect(storedCookie).toBe(sessionCookie);
    expect(requests).toEqual([
      {
        url: "https://sync.example.test/v1/mobile-auth/handoffs",
        body: { audience, codeChallenge: "A".repeat(43) },
      },
      {
        url: "https://sync.example.test/v1/mobile-auth/handoffs/exchange",
        body: { audience, handoffId, code, verifier },
      },
    ]);
  });

  it("rejects a callback containing a bearer cookie without storing it", async () => {
    const storeSessionCookie = vi.fn();
    const adapter = createSecureMobileAuthAdapter({
      audience,
      baseUrl: "https://sync.example.test",
      fetch: vi.fn(async () =>
        Response.json({ handoffId, expiresAt: "2099-01-01T00:00:00.000Z" }, { status: 201 }),
      ),
      generateVerifier: async () => verifier,
      challenge: async () => "A".repeat(43),
      createCallbackUrl,
      beginGoogleSignIn: async () => "https://accounts.google.test/authorize",
      openAuthSession: async (_authorizationUrl, callbackUrl) => ({
        type: "success",
        url: `${callbackUrl}&cookie=${encodeURIComponent(sessionCookie)}`,
      }),
      storeSessionCookie,
    });

    await expect(adapter.signInWithGoogle({ callbackPath: "settings" })).rejects.toThrow(
      /unsafe bearer cookie/i,
    );
    expect(storeSessionCookie).not.toHaveBeenCalled();
  });

  it.each([
    ["access token", (url: string) => `${url}&code=${code}&access_token=provider-access`],
    ["token", (url: string) => `${url}&code=${code}&token=provider-token`],
    ["unknown query", (url: string) => `${url}&code=${code}&unknown=value`],
    ["fragment", (url: string) => `${url}&code=${code}#access_token=provider-access`],
    ["duplicate code", (url: string) => `${url}&code=${code}&code=${"3".repeat(64)}`],
  ])("rejects a callback containing an extra %s field", async (_label, returnedUrl) => {
    const exchange = vi.fn();
    const storeSessionCookie = vi.fn();
    const adapter = createSecureMobileAuthAdapter({
      audience,
      baseUrl: "https://sync.example.test",
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/mobile-auth/handoffs")) {
          return Response.json(
            { handoffId, expiresAt: "2099-01-01T00:00:00.000Z" },
            { status: 201 },
          );
        }
        if (url.endsWith("/v1/mobile-auth/handoffs/exchange")) {
          exchange();
          return Response.json({
            sessionCookie,
            userId: "account-a",
            expiresAt: "2099-01-01T01:00:00.000Z",
          });
        }
        return new Response(null, { status: 204 });
      }),
      generateVerifier: async () => verifier,
      challenge: async () => "A".repeat(43),
      createCallbackUrl,
      beginGoogleSignIn: async () => "https://accounts.google.test/authorize",
      openAuthSession: async (_authorizationUrl, callbackUrl) => ({
        type: "success",
        url: returnedUrl(callbackUrl),
      }),
      storeSessionCookie,
    });

    await expect(adapter.signInWithGoogle({ callbackPath: "settings" })).rejects.toThrow(
      /callback was invalid/i,
    );
    expect(exchange).not.toHaveBeenCalled();
    expect(storeSessionCookie).not.toHaveBeenCalled();
  });

  it("cancels the prepared server handoff when the user closes the browser", async () => {
    const requests: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/v1/mobile-auth/handoffs")) {
        return Response.json({ handoffId, expiresAt: "2099-01-01T00:00:00.000Z" }, { status: 201 });
      }
      if (url.endsWith("/v1/mobile-auth/handoffs/cancel")) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const adapter = createSecureMobileAuthAdapter({
      audience,
      baseUrl: "https://sync.example.test",
      fetch,
      generateVerifier: async () => verifier,
      challenge: async () => "A".repeat(43),
      createCallbackUrl,
      beginGoogleSignIn: async () => "https://accounts.google.test/authorize",
      openAuthSession: async () => ({ type: "cancel" }),
      storeSessionCookie: vi.fn(),
    });

    await expect(adapter.signInWithGoogle({ callbackPath: "settings" })).rejects.toThrow(
      /cancelled/i,
    );
    expect(requests.at(-1)).toBe("https://sync.example.test/v1/mobile-auth/handoffs/cancel");
  });

  it("cancels an in-flight browser when the account generation is superseded", async () => {
    const controller = new AbortController();
    const cancelBodies: unknown[] = [];
    const openAuthSession = vi.fn(() => new Promise<{ type: string }>(() => undefined));
    const dismissAuthSession = vi.fn();
    const adapter = createSecureMobileAuthAdapter({
      audience,
      baseUrl: "https://sync.example.test",
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/mobile-auth/handoffs")) {
          return Response.json(
            { handoffId, expiresAt: "2099-01-01T00:00:00.000Z" },
            { status: 201 },
          );
        }
        if (url.endsWith("/v1/mobile-auth/handoffs/cancel")) {
          cancelBodies.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
      generateVerifier: async () => verifier,
      challenge: async () => "A".repeat(43),
      createCallbackUrl,
      beginGoogleSignIn: async () => "https://accounts.google.test/authorize",
      openAuthSession,
      dismissAuthSession,
      storeSessionCookie: vi.fn(),
    });

    const signIn = adapter.signInWithGoogle({
      callbackPath: "settings",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(openAuthSession).toHaveBeenCalledOnce());
    controller.abort();

    await expect(signIn).rejects.toThrow(/cancelled/i);
    expect(dismissAuthSession).toHaveBeenCalledOnce();
    expect(cancelBodies).toEqual([{ audience, handoffId, verifier }]);
  }, 500);

  it("clears an exchanged cookie if the account generation changes while storing it", async () => {
    const controller = new AbortController();
    const clearSessionCookie = vi.fn(async () => undefined);
    const adapter = createSecureMobileAuthAdapter({
      audience,
      baseUrl: "https://sync.example.test",
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/v1/mobile-auth/handoffs")) {
          return Response.json(
            { handoffId, expiresAt: "2099-01-01T00:00:00.000Z" },
            { status: 201 },
          );
        }
        if (url.endsWith("/v1/mobile-auth/handoffs/exchange")) {
          return Response.json({
            sessionCookie,
            userId: "account-a",
            expiresAt: "2099-01-01T01:00:00.000Z",
          });
        }
        if (url.endsWith("/v1/mobile-auth/handoffs/cancel")) {
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
      generateVerifier: async () => verifier,
      challenge: async () => "A".repeat(43),
      createCallbackUrl,
      beginGoogleSignIn: async () => "https://accounts.google.test/authorize",
      openAuthSession: async (_authorizationUrl, callbackUrl) => ({
        type: "success",
        url: `${callbackUrl}&code=${code}`,
      }),
      async storeSessionCookie() {
        controller.abort();
      },
      clearSessionCookie,
    });

    await expect(
      adapter.signInWithGoogle({ callbackPath: "settings", signal: controller.signal }),
    ).rejects.toThrow(/cancelled/i);
    expect(clearSessionCookie).toHaveBeenCalledOnce();
  });
});
