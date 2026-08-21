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

async function clearLocalSession(
  authClient: ExpoSessionRevocationClient,
  expectedCookie: string,
): Promise<void> {
  if (authClient.getCookie().trim() !== expectedCookie) {
    throw new Error("The local session changed during logout");
  }

  try {
    await authClient.signOut();
    if (authClient.getCookie().trim().length > 0) {
      throw new Error("The local session could not be cleared");
    }
  } catch (error) {
    // The Expo plugin clears its SecureStore cookie before dispatching the
    // sign-out request. Once server absence or revocation is confirmed, an
    // empty cookie is a safe completed logout even if the cleanup response was
    // lost.
    if (authClient.getCookie().trim().length > 0) throw error;
  }
}

/**
 * Revokes the authoritative server session before Better Auth's Expo plugin
 * clears its local SecureStore cookie. Session tokens are handled in memory
 * only and must never be logged or returned to the host application.
 */
export async function revokeExpoSession(authClient: ExpoSessionRevocationClient): Promise<void> {
  const initialCookie = authClient.getCookie().trim();
  if (initialCookie.length === 0) {
    throw new Error("The authoritative session could not be read");
  }

  const current = await authClient.getSession({
    query: { disableCookieCache: true },
  });
  if (!current.error && current.data === null) {
    await clearLocalSession(authClient, initialCookie);
    return;
  }
  const token = current.data?.session?.token;
  if (current.error || typeof token !== "string" || token.length === 0) {
    throw new Error("The authoritative session could not be read");
  }
  if (authClient.getCookie().trim() !== initialCookie) {
    throw new Error("The local session changed during logout");
  }

  const revoked = await authClient.revokeSession({ token });
  if (revoked.error || revoked.data?.status !== true) {
    throw new Error("The authoritative session could not be revoked");
  }
  await clearLocalSession(authClient, initialCookie);
}
