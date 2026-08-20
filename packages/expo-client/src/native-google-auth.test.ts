import { describe, expect, it, vi } from "vitest";
import { createNativeGoogleAuth, type NativeGoogleCredentialProvider } from "./native-google-auth";

const attempt = {
  attemptId: "a".repeat(64),
  nonce: "b".repeat(64),
  webClientId: "123456789-example.apps.googleusercontent.com",
  expiresAt: "2026-08-19T12:05:00.000Z",
};

describe("native Google authentication", () => {
  it("binds the server attempt nonce to the Google ID-token request", async () => {
    const fetch = vi.fn(async () => Response.json(attempt, { status: 201 }));
    const credentialProvider: NativeGoogleCredentialProvider = {
      signIn: vi.fn(async () => ({ idToken: "signed-google-id-token" })),
      clearCredentialState: vi.fn(async () => undefined),
    };
    const social = vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
    const nativeAuth = createNativeGoogleAuth({
      applicationId: "com.example.nativeapp.dev",
      authClient: { signIn: { social } },
      baseUrl: "https://sync.example.test/",
      credentialProvider,
      fetch,
    });

    await expect(nativeAuth.signIn()).resolves.toEqual({ userId: "user-1" });
    expect(fetch).toHaveBeenCalledWith(
      "https://sync.example.test/v1/native-auth/google/attempts",
      expect.objectContaining({
        body: JSON.stringify({ applicationId: "com.example.nativeapp.dev" }),
        credentials: "omit",
        method: "POST",
      }),
    );
    expect(credentialProvider.signIn).toHaveBeenCalledWith({
      webClientId: attempt.webClientId,
      nonce: attempt.nonce,
    });
    expect(social).toHaveBeenCalledWith({
      provider: "google",
      idToken: { token: "signed-google-id-token", nonce: attempt.nonce },
      additionalData: { nativeAttemptId: attempt.attemptId },
    });
  });

  it("rejects an invalid attempt response before opening the account picker", async () => {
    const credentialProvider: NativeGoogleCredentialProvider = {
      signIn: vi.fn(async () => ({ idToken: "unused" })),
      clearCredentialState: vi.fn(async () => undefined),
    };
    const nativeAuth = createNativeGoogleAuth({
      applicationId: "com.example.nativeapp.dev",
      authClient: { signIn: { social: vi.fn() } },
      baseUrl: "https://sync.example.test",
      credentialProvider,
      fetch: vi.fn(async () => Response.json({ ...attempt, nonce: "client-chosen" })),
    });

    await expect(nativeAuth.signIn()).rejects.toThrow();
    expect(credentialProvider.signIn).not.toHaveBeenCalled();
  });

  it("clears native credential state when the server rejects the ID token", async () => {
    const clearCredentialState = vi.fn(async () => undefined);
    const nativeAuth = createNativeGoogleAuth({
      applicationId: "com.example.nativeapp.dev",
      authClient: {
        signIn: {
          social: vi.fn(async () => ({
            data: null,
            error: { message: "nonce already consumed" },
          })),
        },
      },
      baseUrl: "https://sync.example.test",
      credentialProvider: {
        signIn: vi.fn(async () => ({ idToken: "signed-google-id-token" })),
        clearCredentialState,
      },
      fetch: vi.fn(async () => Response.json(attempt, { status: 201 })),
    });

    await expect(nativeAuth.signIn()).rejects.toThrow("nonce already consumed");
    expect(clearCredentialState).toHaveBeenCalledOnce();
  });

  it("treats provider disconnect as best effort", async () => {
    const unsupported = createNativeGoogleAuth({
      applicationId: "com.example.nativeapp.dev",
      authClient: { signIn: { social: vi.fn() } },
      baseUrl: "https://sync.example.test",
      credentialProvider: {
        signIn: vi.fn(),
        clearCredentialState: vi.fn(async () => undefined),
      },
    });
    await expect(unsupported.revokeAccess()).resolves.toBe("unsupported");

    const failed = createNativeGoogleAuth({
      applicationId: "com.example.nativeapp.dev",
      authClient: { signIn: { social: vi.fn() } },
      baseUrl: "https://sync.example.test",
      credentialProvider: {
        signIn: vi.fn(),
        clearCredentialState: vi.fn(async () => undefined),
        revokeAccess: vi.fn(async () => {
          throw new Error("provider unavailable");
        }),
      },
    });
    await expect(failed.revokeAccess()).resolves.toBe("failed");
  });
});
