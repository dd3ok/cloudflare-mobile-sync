import type {
  MobileAuthHandoffCancelRequest,
  MobileAuthHandoffExchangeRequest,
  MobileAuthHandoffExchangeResponse,
  MobileAuthHandoffPrepareRequest,
} from "@cloudflare-mobile-sync/api-contract";
import { parseSetCookieHeader } from "better-auth/cookies";
import { validateTrustedOrigins } from "./auth";
import type { Env } from "./env";
import { PublicError } from "./errors";

const PREPARED_HANDOFF_TTL_MILLISECONDS = 10 * 60 * 1_000;
const READY_HANDOFF_TTL_MILLISECONDS = 60 * 1_000;

interface SessionRow {
  id: string;
  userId: string;
  expiresAt: string | Date;
}

interface BridgedSessionCookie {
  name: string;
  signedValue: string;
  rawToken: string;
}

interface ReadyHandoffRow {
  audience: string;
  code_challenge: string;
  code_hash: string | null;
  session_cookie: string | null;
  session_expires_at: string;
  session_id: string;
  user_id: string;
  expires_at: number;
  current_session_expires_at: string | Date;
  consumed_at: number | null;
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function s256Challenge(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function bridgedSessionCookie(value: string): BridgedSessionCookie | null {
  if (value.length > 8_192) return null;
  const candidates = [...parseSetCookieHeader(value)].filter(([name]) => {
    const normalized = name.startsWith("__Secure-") ? name.slice("__Secure-".length) : name;
    return normalized.endsWith(".session_token") || normalized.endsWith("-session_token");
  });
  if (candidates.length !== 1) return null;
  const [name, cookie] = candidates[0] ?? [];
  const signedValue = cookie?.value;
  const rawToken = signedValue?.split(".", 1)[0];
  if (!name || !signedValue || !rawToken || signedValue.length > 4_096) return null;
  return { name, signedValue, rawToken };
}

function sanitizedRedirect(response: Response, redirect: URL): Response {
  const headers = new Headers(response.headers);
  headers.delete("Set-Cookie");
  headers.set("Location", redirect.toString());
  return new Response(response.body, { headers, status: response.status });
}

function boundedPrivateCallback(source: URL, handoffId?: string): URL {
  const callback = new URL(
    source.host
      ? `${source.protocol}//${source.host}${source.pathname}`
      : `${source.protocol}///${source.pathname.replace(/^\/+|\/+$/gu, "")}`,
  );
  if (handoffId && /^[A-Fa-f0-9]{64}$/u.test(handoffId)) {
    callback.searchParams.set("mobile_handoff", handoffId);
  }
  return callback;
}

async function revokeUnclaimedSession(db: D1Database, rawToken: string): Promise<void> {
  await db.prepare(`DELETE FROM session WHERE token = ?`).bind(rawToken).run();
}

async function completeMobileAuthHandoff(
  env: Pick<Env, "DB">,
  handoffId: string,
  audience: string,
  cookie: BridgedSessionCookie,
): Promise<string | null> {
  const now = Date.now();
  const session = await env.DB.prepare(`SELECT id, userId, expiresAt FROM session WHERE token = ?`)
    .bind(cookie.rawToken)
    .first<SessionRow>();
  const sessionExpiresAt = session ? new Date(session.expiresAt).getTime() : Number.NaN;
  if (!session || !Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= now) return null;

  const code = randomHex(32);
  const codeHash = await sha256Hex(code);
  const expiresAt = Math.min(now + READY_HANDOFF_TTL_MILLISECONDS, sessionExpiresAt);
  const originalSessionExpiresAt = new Date(sessionExpiresAt).toISOString();
  const readySessionExpiresAt = new Date(expiresAt).toISOString();
  const maxAgeSeconds = Math.max(1, Math.floor((sessionExpiresAt - now) / 1_000));
  const sessionCookie = `${cookie.name}=${cookie.signedValue}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE mobile_auth_handoff
         SET code_hash = ?, session_cookie = ?, session_expires_at = ?,
             session_id = ?, user_id = ?, ready_at = ?, expires_at = ?
       WHERE id = ? AND audience = ? AND expires_at > ? AND code_hash IS NULL`,
    ).bind(
      codeHash,
      sessionCookie,
      originalSessionExpiresAt,
      session.id,
      session.userId,
      now,
      expiresAt,
      handoffId,
      audience,
      now,
    ),
    env.DB.prepare(
      `UPDATE session SET expiresAt = ?, updatedAt = ? WHERE id = ? AND token = ?`,
    ).bind(readySessionExpiresAt, new Date(now).toISOString(), session.id, cookie.rawToken),
  ]);
  return results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1 ? code : null;
}

function trustedMobileAudiences(env: Pick<Env, "TRUSTED_ORIGINS">): ReadonlySet<string> {
  return new Set(
    validateTrustedOrigins(env)
      .filter((origin) => !origin.startsWith("http://") && !origin.startsWith("https://"))
      .map((origin) => new URL(origin).protocol.slice(0, -1)),
  );
}

export async function pruneExpiredMobileAuthHandoffs(db: D1Database, now: number): Promise<void> {
  // A ready handoff owns the just-created mobile session until a successful
  // exchange marks it consumed. Expiry revokes only an unconsumed session;
  // prepared rows have no session, while consumed sessions remain valid.
  await db.batch([
    db
      .prepare(
        `DELETE FROM session
       WHERE id IN (
         SELECT session_id
         FROM mobile_auth_handoff
         WHERE expires_at <= ? AND ready_at IS NOT NULL AND consumed_at IS NULL
           AND session_id IS NOT NULL
       )`,
      )
      .bind(now),
    db.prepare(`DELETE FROM mobile_auth_handoff WHERE expires_at <= ?`).bind(now),
  ]);
}

export async function prepareMobileAuthHandoff(
  env: Pick<Env, "DB" | "TRUSTED_ORIGINS">,
  request: MobileAuthHandoffPrepareRequest,
): Promise<{ handoffId: string; expiresAt: string }> {
  if (!trustedMobileAudiences(env).has(request.audience)) {
    throw new PublicError(403, "FORBIDDEN", "Mobile app audience is not allowed");
  }

  const now = Date.now();
  const expiresAt = now + PREPARED_HANDOFF_TTL_MILLISECONDS;
  const handoffId = randomHex(32);
  await pruneExpiredMobileAuthHandoffs(env.DB, now);
  await env.DB.prepare(
    `INSERT INTO mobile_auth_handoff
       (id, audience, code_challenge, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(handoffId, request.audience, request.codeChallenge, now, expiresAt)
    .run();

  return { handoffId, expiresAt: new Date(expiresAt).toISOString() };
}

export async function secureMobileAuthRedirect(
  env: Pick<Env, "DB">,
  response: Response,
): Promise<Response> {
  const location = response.headers.get("Location");
  if (!location) return response;

  let redirect: URL;
  try {
    redirect = new URL(location);
  } catch {
    return response;
  }
  if (redirect.protocol === "http:" || redirect.protocol === "https:") return response;

  const cookieValues = redirect.searchParams.getAll("cookie");
  const handoffValues = redirect.searchParams.getAll("mobile_handoff");
  const rawCookie = cookieValues.length === 1 ? cookieValues[0] : null;
  const handoffId = handoffValues.length === 1 ? handoffValues[0] : undefined;
  const callback = boundedPrivateCallback(redirect, handoffId);
  if (!rawCookie) {
    callback.searchParams.set("error", "mobile_auth_failed");
    return sanitizedRedirect(response, callback);
  }

  const cookie = bridgedSessionCookie(rawCookie);
  const audience = redirect.protocol.slice(0, -1);
  if (!cookie || !handoffId || !/^[A-Fa-f0-9]{64}$/u.test(handoffId)) {
    if (cookie) await revokeUnclaimedSession(env.DB, cookie.rawToken);
    callback.searchParams.set("error", "mobile_handoff_required");
    return sanitizedRedirect(response, callback);
  }

  const code = await completeMobileAuthHandoff(env, handoffId, audience, cookie);
  if (!code) {
    await revokeUnclaimedSession(env.DB, cookie.rawToken);
    callback.searchParams.set("error", "mobile_handoff_invalid");
    return sanitizedRedirect(response, callback);
  }

  callback.searchParams.set("code", code);
  return sanitizedRedirect(response, callback);
}

function invalidHandoff(): PublicError {
  return new PublicError(401, "UNAUTHORIZED", "Mobile auth handoff is invalid or expired");
}

export async function exchangeMobileAuthHandoff(
  env: Pick<Env, "DB">,
  request: MobileAuthHandoffExchangeRequest,
): Promise<MobileAuthHandoffExchangeResponse> {
  const now = Date.now();
  await pruneExpiredMobileAuthHandoffs(env.DB, now);
  const row = await env.DB.prepare(
    `SELECT
       handoff.audience,
       handoff.code_challenge,
       handoff.code_hash,
       handoff.session_cookie,
       handoff.session_expires_at,
       handoff.session_id,
       handoff.user_id,
       handoff.expires_at,
       handoff.consumed_at,
       session.expiresAt AS current_session_expires_at
     FROM mobile_auth_handoff AS handoff
     JOIN session ON session.id = handoff.session_id AND session.userId = handoff.user_id
     WHERE handoff.id = ?`,
  )
    .bind(request.handoffId)
    .first<ReadyHandoffRow>();
  if (!row) throw invalidHandoff();

  const [codeHash, verifierChallenge] = await Promise.all([
    sha256Hex(request.code),
    s256Challenge(request.verifier),
  ]);
  const sessionExpiresAt = new Date(row.session_expires_at).getTime();
  const currentSessionExpiresAt = new Date(row.current_session_expires_at).getTime();
  if (
    row.audience !== request.audience ||
    row.code_hash !== codeHash ||
    row.session_cookie === null ||
    row.code_challenge !== verifierChallenge ||
    row.consumed_at !== null ||
    row.expires_at <= now ||
    !Number.isFinite(sessionExpiresAt) ||
    sessionExpiresAt <= now ||
    !Number.isFinite(currentSessionExpiresAt) ||
    currentSessionExpiresAt <= now
  ) {
    throw invalidHandoff();
  }

  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE mobile_auth_handoff
       SET consumed_at = ?, code_hash = NULL, session_cookie = NULL
       WHERE id = ? AND audience = ? AND code_hash = ? AND expires_at > ?
         AND consumed_at IS NULL
       RETURNING user_id`,
    ).bind(now, request.handoffId, request.audience, codeHash, now),
    env.DB.prepare(
      `UPDATE session
       SET expiresAt = ?, updatedAt = ?
       WHERE id = (
         SELECT session_id FROM mobile_auth_handoff
         WHERE id = ? AND audience = ? AND code_hash IS NULL AND consumed_at = ?
       )`,
    ).bind(
      row.session_expires_at,
      new Date(now).toISOString(),
      request.handoffId,
      request.audience,
      now,
    ),
  ]);
  const consumed = (results[0]?.results[0] ?? null) as {
    user_id: string;
  } | null;
  if (!consumed || results[1]?.meta.changes !== 1) throw invalidHandoff();

  return {
    sessionCookie: row.session_cookie,
    userId: consumed.user_id,
    expiresAt: new Date(sessionExpiresAt).toISOString(),
  };
}

export async function cancelMobileAuthHandoff(
  env: Pick<Env, "DB">,
  request: MobileAuthHandoffCancelRequest,
): Promise<void> {
  const now = Date.now();
  await pruneExpiredMobileAuthHandoffs(env.DB, now);
  const row = await env.DB.prepare(
    `SELECT audience, code_challenge
     FROM mobile_auth_handoff
     WHERE id = ? AND expires_at > ?`,
  )
    .bind(request.handoffId, now)
    .first<{ audience: string; code_challenge: string }>();
  if (
    !row ||
    row.audience !== request.audience ||
    row.code_challenge !== (await s256Challenge(request.verifier))
  ) {
    throw invalidHandoff();
  }

  const results = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM session
       WHERE id IN (
         SELECT session_id FROM mobile_auth_handoff
         WHERE id = ? AND audience = ? AND code_challenge = ?
           AND expires_at > ? AND session_id IS NOT NULL
       )`,
    ).bind(request.handoffId, request.audience, row.code_challenge, now),
    env.DB.prepare(
      `DELETE FROM mobile_auth_handoff
       WHERE id = ? AND audience = ? AND code_challenge = ? AND expires_at > ?`,
    ).bind(request.handoffId, request.audience, row.code_challenge, now),
  ]);
  if ((results[1]?.meta.changes ?? 0) < 1 && (results[0]?.meta.changes ?? 0) < 1) {
    throw invalidHandoff();
  }
}
