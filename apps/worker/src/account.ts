import {
  type AccountDeletionOutcome,
  type AccountResponse,
  accountDeletionOutcomeSchema,
} from "@cloudflare-mobile-sync/api-contract";
import type { Auth } from "./auth";
import type { Env } from "./env";
import { PublicError } from "./errors";
import { fetchWithTimeout } from "./fetch";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  sessionCreatedAt: Date;
}

interface AccountRow {
  id: string;
  providerId: string;
  accountId: string;
}

export interface ProviderDeletionOutcome {
  providerIds: string[];
  providerRevocationFailures: string[];
}

export interface AccountDeletionReceiptInput {
  operationId: string;
  expectedSubjectId: string;
}

type ProviderAccessRevoker = (account: AccountRow) => Promise<void>;

export async function getAccount(
  db: D1Database,
  user: AuthenticatedUser,
): Promise<AccountResponse> {
  const accounts = await db
    .prepare(`SELECT id, providerId, accountId FROM account WHERE userId = ? ORDER BY providerId`)
    .bind(user.id)
    .all<AccountRow>();
  const placeholder = user.email.endsWith("@placeholder.invalid");

  return {
    user: {
      id: user.id,
      name: user.name,
      email: placeholder ? null : user.email,
      emailIsPlaceholder: placeholder,
      image: user.image,
    },
    providers: accounts.results.map((account) => ({
      providerId: account.providerId,
      accountId: account.accountId,
    })),
  };
}

async function revokeProvider(
  env: Env,
  auth: Auth,
  requestHeaders: Headers,
  account: AccountRow,
): Promise<void> {
  const token = await auth.api.getAccessToken({
    body: { providerId: account.providerId, accountId: account.accountId },
    headers: requestHeaders,
  });
  const accessToken = token.accessToken;

  let response: Response;
  if (account.providerId === "google") {
    response = await fetchWithTimeout("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }),
      redirect: "error",
    });
    if (isGoogleRevocationConfirmed(response)) return;
  } else if (account.providerId === "kakao") {
    response = await fetchWithTimeout("https://kapi.kakao.com/v1/user/unlink", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
    });
    if (response.ok) return;
    if (response.status === 400) {
      const body = (await response.json().catch(() => null)) as { code?: number } | null;
      if (body?.code === -101) return;
    }
  } else if (account.providerId === "naver") {
    if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
      throw new PublicError(503, "PROVIDER_UNAVAILABLE", "Naver is not configured", true);
    }
    const body = new URLSearchParams({
      grant_type: "delete",
      client_id: env.NAVER_CLIENT_ID,
      client_secret: env.NAVER_CLIENT_SECRET,
      access_token: accessToken,
      service_provider: "NAVER",
    });
    response = await fetchWithTimeout("https://nid.naver.com/oauth2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
    });
    if (response.ok) return;
  } else {
    throw new PublicError(409, "FORBIDDEN", "Unknown provider cannot be unlinked safely");
  }

  throw new PublicError(
    503,
    "PROVIDER_UNAVAILABLE",
    "The login provider could not complete account unlinking",
    true,
  );
}

export function isGoogleRevocationConfirmed(response: Response): boolean {
  // Google's revoke endpoint documents 200 as the confirmation response. Do
  // not broaden that contract to every 2xx status, and never treat a 400 as
  // proof that every provider grant for this account has been removed.
  return response.status === 200;
}

export async function deleteAccountData(
  db: D1Database,
  userId: string,
  revokeAccess: ProviderAccessRevoker,
  receipt?: AccountDeletionReceiptInput,
): Promise<ProviderDeletionOutcome> {
  const accounts = await db
    .prepare(`SELECT id, providerId, accountId FROM account WHERE userId = ? ORDER BY providerId`)
    .bind(userId)
    .all<AccountRow>();

  const providerRevocationFailures = new Set<string>();
  for (const account of accounts.results) {
    try {
      await revokeAccess(account);
    } catch {
      providerRevocationFailures.add(account.providerId);
    }
  }

  const providerIds = [...new Set(accounts.results.map((account) => account.providerId))].sort();
  if (receipt) {
    const completedAt = new Date().toISOString();
    const outcome = deletionOutcome(receipt.operationId, completedAt, providerIds, [
      ...providerRevocationFailures,
    ]);
    const receiptInsert = await deletionReceiptInsert(db, receipt, outcome);
    const [stored, deleted] = await db.batch([
      receiptInsert,
      db.prepare(`DELETE FROM user WHERE id = ?`).bind(userId),
    ]);
    if (stored?.meta.changes !== 1 || deleted?.meta.changes !== 1) {
      throw new Error("Account deletion receipt was not committed with user deletion");
    }
  } else {
    const deleted = await db.prepare(`DELETE FROM user WHERE id = ?`).bind(userId).run();
    if (deleted.meta.changes < 1) throw new Error("Account deletion did not delete a user");
  }

  return { providerIds, providerRevocationFailures: [...providerRevocationFailures].sort() };
}

export async function revokeProvidersAndDelete(
  env: Env,
  auth: Auth,
  user: AuthenticatedUser,
  requestHeaders: Headers,
  receipt?: AccountDeletionReceiptInput,
): Promise<ProviderDeletionOutcome> {
  return deleteAccountData(
    env.DB,
    user.id,
    (account) => revokeProvider(env, auth, requestHeaders, account),
    receipt,
  );
}

const DELETION_RECEIPT_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deletionOutcome(
  operationId: string,
  completedAt: string,
  providerIds: readonly string[],
  failures: readonly string[],
): AccountDeletionOutcome {
  const unconfirmed = new Set(failures);
  return {
    operationId,
    serverDataDeleted: true,
    providerRevocations: providerIds.map((providerId) => ({
      providerId,
      status: unconfirmed.has(providerId) ? "unconfirmed" : "confirmed",
    })),
    completedAt,
  };
}

async function deletionReceiptInsert(
  db: D1Database,
  receipt: AccountDeletionReceiptInput,
  outcome: AccountDeletionOutcome,
): Promise<D1PreparedStatement> {
  return db
    .prepare(
      `INSERT INTO account_deletion_receipt
         (operation_hash, subject_hash, result_json, completed_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256Hex(receipt.operationId),
      await sha256Hex(receipt.expectedSubjectId),
      JSON.stringify({
        serverDataDeleted: outcome.serverDataDeleted,
        providerRevocations: outcome.providerRevocations,
        completedAt: outcome.completedAt,
      }),
      outcome.completedAt,
      Date.parse(outcome.completedAt) + DELETION_RECEIPT_TTL_MILLISECONDS,
    );
}

export async function storeAccountDeletionReceipt(
  db: D1Database,
  receipt: AccountDeletionReceiptInput,
  providerOutcome: ProviderDeletionOutcome,
): Promise<AccountDeletionOutcome> {
  const completedAt = new Date().toISOString();
  const outcome = deletionOutcome(
    receipt.operationId,
    completedAt,
    providerOutcome.providerIds,
    providerOutcome.providerRevocationFailures,
  );
  const stored = await (await deletionReceiptInsert(db, receipt, outcome)).run();
  if (stored.meta.changes !== 1) throw new Error("Account deletion receipt was not stored");
  return outcome;
}

export async function readAccountDeletionReceipt(
  db: D1Database,
  receipt: AccountDeletionReceiptInput,
): Promise<AccountDeletionOutcome | null> {
  const now = Date.now();
  await pruneExpiredAccountDeletionReceipts(db, now);
  const row = await db
    .prepare(
      `SELECT result_json FROM account_deletion_receipt
       WHERE operation_hash = ? AND subject_hash = ? AND expires_at > ?`,
    )
    .bind(await sha256Hex(receipt.operationId), await sha256Hex(receipt.expectedSubjectId), now)
    .first<{ result_json: string }>();
  if (!row) return null;
  const stored = JSON.parse(row.result_json) as Partial<AccountDeletionOutcome>;
  return accountDeletionOutcomeSchema.parse({
    operationId: receipt.operationId,
    serverDataDeleted: stored.serverDataDeleted,
    providerRevocations: stored.providerRevocations,
    completedAt: stored.completedAt,
  });
}

export async function pruneExpiredAccountDeletionReceipts(
  db: D1Database,
  now: number,
): Promise<void> {
  await db.prepare(`DELETE FROM account_deletion_receipt WHERE expires_at <= ?`).bind(now).run();
}
