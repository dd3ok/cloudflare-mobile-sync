interface SessionSnapshot {
  data?: {
    session?: {
      token?: unknown;
    };
  } | null;
  error?: unknown;
}

interface SessionRevocationResult {
  data?: {
    status?: unknown;
  } | null;
  error?: unknown;
}

interface SignOutResult {
  error?: unknown;
}

export interface ExpoSessionRevocationClient {
  getCookie(): string;
  getSession(input: { query: { disableCookieCache: true } }): Promise<SessionSnapshot>;
  revokeSession(input: { token: string }): Promise<SessionRevocationResult>;
  signOut(): Promise<SignOutResult>;
}

/**
 * Revokes the authoritative server session before Better Auth's Expo plugin
 * clears its local SecureStore cookie. Session tokens are handled in memory
 * only and must never be logged or returned to the host application.
 */
export async function revokeExpoSession(authClient: ExpoSessionRevocationClient): Promise<void> {
  const current = await authClient.getSession({
    query: { disableCookieCache: true },
  });
  const token = current.data?.session?.token;
  if (current.error || typeof token !== "string" || token.length === 0) {
    throw new Error("The authoritative session could not be read");
  }

  const revoked = await authClient.revokeSession({ token });
  if (revoked.error || revoked.data?.status !== true) {
    throw new Error("The authoritative session could not be revoked");
  }

  try {
    const signedOut = await authClient.signOut();
    if (signedOut.error && authClient.getCookie().trim().length > 0) {
      throw new Error("The local session could not be cleared");
    }
  } catch (error) {
    // The Expo plugin clears its SecureStore cookie before dispatching the
    // sign-out request. Once server revocation succeeded, an empty cookie is a
    // safe completed logout even if that cleanup request lost its response.
    if (authClient.getCookie().trim().length > 0) throw error;
  }
}
