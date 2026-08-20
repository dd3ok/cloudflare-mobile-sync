import {
  type NativeGoogleAuthAttemptResponse,
  nativeGoogleAuthAttemptResponseSchema,
} from "@cloudflare-mobile-sync/api-contract";

export interface NativeGoogleCredentialProvider {
  signIn(input: { webClientId: string; nonce: string }): Promise<{ idToken: string }>;
  clearCredentialState(): Promise<void>;
  revokeAccess?(): Promise<void>;
}

export interface NativeGoogleSignInResult {
  userId: string;
}

export interface NativeGoogleAuth {
  signIn(): Promise<NativeGoogleSignInResult>;
  clearCredentialState(): Promise<void>;
  revokeAccess(): Promise<"requested" | "unsupported" | "failed">;
}

interface NativeGoogleAuthClient {
  signIn: {
    social(input: {
      provider: "google";
      idToken: { token: string; nonce: string };
      additionalData: { nativeAttemptId: string };
    }): Promise<{
      data?: unknown;
      error?: unknown;
    }>;
  };
}

export interface NativeGoogleAuthOptions {
  applicationId: string;
  authClient: NativeGoogleAuthClient;
  baseUrl: string;
  credentialProvider: NativeGoogleCredentialProvider;
  fetch?: typeof globalThis.fetch;
}

async function readAttempt(response: Response): Promise<NativeGoogleAuthAttemptResponse> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error("Native Google authentication attempt could not be created");
  }
  return nativeGoogleAuthAttemptResponseSchema.parse(payload);
}

export function createNativeGoogleAuth(options: NativeGoogleAuthOptions): NativeGoogleAuth {
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return {
    async signIn() {
      const attempt = await readAttempt(
        await fetchImplementation(`${baseUrl}/v1/native-auth/google/attempts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId: options.applicationId }),
          credentials: "omit",
        }),
      );
      const credential = await options.credentialProvider.signIn({
        webClientId: attempt.webClientId,
        nonce: attempt.nonce,
      });
      let result: Awaited<ReturnType<NativeGoogleAuthClient["signIn"]["social"]>>;
      try {
        result = await options.authClient.signIn.social({
          provider: "google",
          idToken: { token: credential.idToken, nonce: attempt.nonce },
          additionalData: { nativeAttemptId: attempt.attemptId },
        });
      } catch (error) {
        await options.credentialProvider.clearCredentialState().catch(() => undefined);
        throw error;
      }
      const data =
        typeof result.data === "object" && result.data !== null
          ? (result.data as { user?: { id?: unknown } })
          : null;
      const userId = typeof data?.user?.id === "string" ? data.user.id : undefined;
      const errorMessage =
        typeof result.error === "object" &&
        result.error !== null &&
        "message" in result.error &&
        typeof result.error.message === "string"
          ? result.error.message
          : undefined;
      if (result.error || !userId) {
        await options.credentialProvider.clearCredentialState().catch(() => undefined);
        throw new Error(errorMessage ?? "Native Google sign-in failed");
      }
      return { userId };
    },
    clearCredentialState() {
      return options.credentialProvider.clearCredentialState();
    },
    async revokeAccess() {
      if (!options.credentialProvider.revokeAccess) return "unsupported";
      try {
        await options.credentialProvider.revokeAccess();
        return "requested";
      } catch {
        return "failed";
      }
    },
  };
}
