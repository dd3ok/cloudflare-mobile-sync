import type {
  NativeGoogleAuthAttemptRequest,
  NativeGoogleAuthAttemptResponse,
  NativeGoogleSignInRequest,
} from "@cloudflare-mobile-sync/api-contract";
import type { Env } from "./env";
import { PublicError } from "./errors";

const ATTEMPT_TTL_MILLISECONDS = 5 * 60 * 1_000;

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function pruneExpiredNativeGoogleAuthAttempts(
  db: D1Database,
  now: number,
): Promise<void> {
  await db.prepare(`DELETE FROM native_google_auth_attempt WHERE expires_at <= ?`).bind(now).run();
}

export async function createNativeGoogleAuthAttempt(
  env: Pick<Env, "DB" | "GOOGLE_WEB_CLIENT_ID" | "NATIVE_APPLICATION_ID">,
  request: NativeGoogleAuthAttemptRequest,
): Promise<NativeGoogleAuthAttemptResponse> {
  if (request.applicationId !== env.NATIVE_APPLICATION_ID) {
    throw new PublicError(403, "FORBIDDEN", "Native application is not allowed");
  }

  const now = Date.now();
  const expiresAt = now + ATTEMPT_TTL_MILLISECONDS;
  const attemptId = randomHex(32);
  const nonce = randomHex(32);
  await pruneExpiredNativeGoogleAuthAttempts(env.DB, now);
  await env.DB.prepare(
    `INSERT INTO native_google_auth_attempt
       (id, application_id, nonce_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(attemptId, request.applicationId, await sha256Hex(nonce), now, expiresAt)
    .run();

  return {
    attemptId,
    nonce,
    webClientId: env.GOOGLE_WEB_CLIENT_ID,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export async function consumeNativeGoogleAuthAttempt(
  env: Pick<Env, "DB" | "NATIVE_APPLICATION_ID">,
  request: NativeGoogleSignInRequest,
): Promise<void> {
  const now = Date.now();
  const consumed = await env.DB.prepare(
    `UPDATE native_google_auth_attempt
     SET consumed_at = ?
     WHERE id = ? AND application_id = ? AND nonce_hash = ?
       AND consumed_at IS NULL AND expires_at > ?
     RETURNING id`,
  )
    .bind(
      now,
      request.additionalData.nativeAttemptId,
      env.NATIVE_APPLICATION_ID,
      await sha256Hex(request.idToken.nonce),
      now,
    )
    .first<{ id: string }>();

  if (!consumed) {
    throw new PublicError(
      401,
      "UNAUTHORIZED",
      "Native Google authentication attempt is invalid or expired",
    );
  }
}
