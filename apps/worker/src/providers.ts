import type { GenericOAuthConfig } from "better-auth/plugins";
import type { Env } from "./env";
import { fetchWithTimeout } from "./fetch";

interface KakaoProfile {
  id?: number;
  properties?: {
    nickname?: string;
    profile_image?: string;
  };
  kakao_account?: {
    email?: string;
    is_email_valid?: boolean;
    is_email_verified?: boolean;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
  };
}

interface NaverProfileResponse {
  resultcode?: string;
  response?: {
    id?: string;
    email?: string;
    name?: string;
    nickname?: string;
    profile_image?: string;
  };
}

async function placeholderEmail(providerId: string, subject: string): Promise<string> {
  const source = new TextEncoder().encode(`${providerId}:${subject}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  const localPart = Array.from(digest.slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${providerId}.${localPart}@placeholder.invalid`;
}

async function fetchJson<T>(url: string, accessToken: string): Promise<T | null> {
  const response = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "error",
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export function genericProviderConfigs(env: Env): GenericOAuthConfig[] {
  const providers: GenericOAuthConfig[] = [];

  if (env.KAKAO_CLIENT_ID && env.KAKAO_CLIENT_SECRET) {
    providers.push({
      providerId: "kakao",
      discoveryUrl: "https://kauth.kakao.com/.well-known/openid-configuration",
      clientId: env.KAKAO_CLIENT_ID,
      clientSecret: env.KAKAO_CLIENT_SECRET,
      scopes: ["openid", "profile_nickname", "profile_image", "account_email"],
      pkce: true,
      async getUserInfo(tokens) {
        if (!tokens.accessToken) return null;
        const profile = await fetchJson<KakaoProfile>(
          "https://kapi.kakao.com/v2/user/me",
          tokens.accessToken,
        );
        if (!profile?.id) return null;

        const subject = String(profile.id);
        const account = profile.kakao_account;
        return {
          id: subject,
          name: account?.profile?.nickname ?? profile.properties?.nickname ?? "Kakao user",
          email: account?.email ?? (await placeholderEmail("kakao", subject)),
          image: account?.profile?.profile_image_url ?? profile.properties?.profile_image,
          emailVerified: Boolean(
            account?.email && account.is_email_valid && account.is_email_verified,
          ),
        };
      },
    });
  }

  if (env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET) {
    providers.push({
      providerId: "naver",
      authorizationUrl: "https://nid.naver.com/oauth2.0/authorize",
      tokenUrl: "https://nid.naver.com/oauth2.0/token",
      userInfoUrl: "https://openapi.naver.com/v1/nid/me",
      clientId: env.NAVER_CLIENT_ID,
      clientSecret: env.NAVER_CLIENT_SECRET,
      scopes: ["name", "email", "profile_image", "nickname"],
      async getUserInfo(tokens) {
        if (!tokens.accessToken) return null;
        const result = await fetchJson<NaverProfileResponse>(
          "https://openapi.naver.com/v1/nid/me",
          tokens.accessToken,
        );
        const profile = result?.response;
        if (result?.resultcode !== "00" || !profile?.id) return null;

        return {
          id: profile.id,
          name: profile.name ?? profile.nickname ?? "Naver user",
          email: profile.email ?? (await placeholderEmail("naver", profile.id)),
          image: profile.profile_image,
          emailVerified: false,
        };
      },
    });
  }

  return providers;
}
