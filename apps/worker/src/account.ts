import type { AccountResponse } from "@cloudflare-mobile-sync/api-contract";
import type { Auth } from "./auth";
import type { Env } from "./env";
import { PublicError } from "./errors";

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
    response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken }),
      redirect: "error",
    });
    if (response.ok || response.status === 400) return;
  } else if (account.providerId === "kakao") {
    response = await fetch("https://kapi.kakao.com/v1/user/unlink", {
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
    response = await fetch("https://nid.naver.com/oauth2.0/token", {
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

export async function revokeProvidersAndDelete(
  env: Env,
  auth: Auth,
  user: AuthenticatedUser,
  requestHeaders: Headers,
): Promise<void> {
  const accounts = await env.DB.prepare(
    `SELECT id, providerId, accountId FROM account WHERE userId = ? ORDER BY providerId`,
  )
    .bind(user.id)
    .all<AccountRow>();

  for (const account of accounts.results) {
    await revokeProvider(env, auth, requestHeaders, account);
  }

  const deleted = await env.DB.prepare(`DELETE FROM user WHERE id = ?`).bind(user.id).run();
  if (deleted.meta.changes !== 1) throw new Error("Account deletion did not delete one user");
}
