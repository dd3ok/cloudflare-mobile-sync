import { describe, expect, it, vi } from "vitest";
import { type ExpoSessionRevocationClient, revokeExpoSession } from "./session-revocation";

function client(overrides: Partial<ExpoSessionRevocationClient> = {}) {
  let cookie = "better-auth.session_token=opaque-test-value";
  const calls: string[] = [];
  const value: ExpoSessionRevocationClient = {
    getCookie: vi.fn(() => cookie),
    getSession: vi.fn(async () => ({
      data: { session: { token: "opaque-test-token" } },
    })),
    revokeSession: vi.fn(async ({ token }) => {
      calls.push(`revoke:${token}`);
      return { data: { status: true } };
    }),
    signOut: vi.fn(async () => {
      calls.push("clear-local");
      cookie = "";
      return {};
    }),
    ...overrides,
  };
  return { calls, value };
}

describe("revokeExpoSession", () => {
  it("revokes the authoritative session before clearing the local cookie", async () => {
    const fixture = client();

    await revokeExpoSession(fixture.value);

    expect(fixture.calls).toEqual(["revoke:opaque-test-token", "clear-local"]);
  });

  it("does not clear the local cookie when the authoritative read fails", async () => {
    const fixture = client({
      getSession: vi.fn(async () => ({ error: { status: 401 } })),
    });

    await expect(revokeExpoSession(fixture.value)).rejects.toThrow(
      "authoritative session could not be read",
    );
    expect(fixture.value.revokeSession).not.toHaveBeenCalled();
    expect(fixture.value.signOut).not.toHaveBeenCalled();
  });

  it("clears a stale local cookie when the server definitively has no session", async () => {
    const fixture = client({
      getSession: vi.fn(async () => ({ data: null })),
    });

    await expect(revokeExpoSession(fixture.value)).resolves.toBeUndefined();
    expect(fixture.value.revokeSession).not.toHaveBeenCalled();
    expect(fixture.value.signOut).toHaveBeenCalledOnce();
  });

  it("does not clear the local cookie when server revocation fails", async () => {
    const fixture = client({
      revokeSession: vi.fn(async () => ({ error: { status: 500 } })),
    });

    await expect(revokeExpoSession(fixture.value)).rejects.toThrow(
      "authoritative session could not be revoked",
    );
    expect(fixture.value.signOut).not.toHaveBeenCalled();
  });

  it("accepts a lost cleanup response only after revocation emptied the cookie", async () => {
    let cookie = "better-auth.session_token=opaque-test-value";
    const fixture = client({
      getCookie: vi.fn(() => cookie),
      signOut: vi.fn(async () => {
        cookie = "";
        throw new Error("response lost");
      }),
    });

    await expect(revokeExpoSession(fixture.value)).resolves.toBeUndefined();
  });

  it("fails when local cleanup leaves the cookie present", async () => {
    const fixture = client({
      signOut: vi.fn(async () => ({ error: { status: 503 } })),
    });

    await expect(revokeExpoSession(fixture.value)).rejects.toThrow(
      "local session could not be cleared",
    );
  });

  it("fails when nominally successful local cleanup leaves the cookie present", async () => {
    const fixture = client({
      signOut: vi.fn(async () => ({})),
    });

    await expect(revokeExpoSession(fixture.value)).rejects.toThrow(
      "local session could not be cleared",
    );
  });

  it("does not revoke when the local session changes during the authoritative read", async () => {
    const fixture = client({
      getCookie: vi
        .fn()
        .mockReturnValueOnce("better-auth.session_token=session-a")
        .mockReturnValue("better-auth.session_token=session-b"),
    });

    await expect(revokeExpoSession(fixture.value)).rejects.toThrow(
      "local session changed during logout",
    );
    expect(fixture.value.revokeSession).not.toHaveBeenCalled();
    expect(fixture.value.signOut).not.toHaveBeenCalled();
  });

  it("does not clear a replacement local session after revocation", async () => {
    const fixture = client({
      getCookie: vi
        .fn()
        .mockReturnValueOnce("better-auth.session_token=session-a")
        .mockReturnValueOnce("better-auth.session_token=session-a")
        .mockReturnValue("better-auth.session_token=session-b"),
    });

    await expect(revokeExpoSession(fixture.value)).rejects.toThrow(
      "local session changed during logout",
    );
    expect(fixture.value.revokeSession).toHaveBeenCalledOnce();
    expect(fixture.value.signOut).not.toHaveBeenCalled();
  });
});
