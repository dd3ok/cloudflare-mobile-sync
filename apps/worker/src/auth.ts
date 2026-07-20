import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { genericOAuth } from "better-auth/plugins";
import { commaSeparated, type Env } from "./env";
import { genericProviderConfigs } from "./providers";

interface VersionedSecret {
  version: number;
  value: string;
}

export function parseVersionedSecrets(value: string | undefined): VersionedSecret[] {
  if (!value?.trim()) return [];
  const secrets = value.split(",").map((entry) => {
    const normalized = entry.trim();
    const separator = normalized.indexOf(":");
    const versionText = normalized.slice(0, separator);
    const version = Number(versionText);
    const secret = normalized.slice(separator + 1).trim();
    if (
      separator < 1 ||
      !/^(0|[1-9][0-9]*)$/u.test(versionText) ||
      !Number.isSafeInteger(version) ||
      secret.length < 32
    ) {
      throw new Error("BETTER_AUTH_SECRETS must use version:secret entries with 32+ byte secrets");
    }
    return { version, value: secret };
  });
  if (new Set(secrets.map((secret) => secret.version)).size !== secrets.length) {
    throw new Error("BETTER_AUTH_SECRETS versions must be unique");
  }
  return secrets;
}

export function createAuth(env: Env) {
  const genericProviders = genericProviderConfigs(env);
  const secrets = parseVersionedSecrets(env.BETTER_AUTH_SECRETS);
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            scope: ["openid", "email", "profile"],
          },
        }
      : {};

  return betterAuth({
    appName: "Cloudflare Mobile Sync",
    basePath: "/v1/auth",
    baseURL: env.BETTER_AUTH_URL,
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    ...(secrets.length > 0 ? { secrets } : {}),
    trustedOrigins: commaSeparated(env.TRUSTED_ORIGINS),
    socialProviders: google,
    plugins: [
      expo(),
      ...(genericProviders.length ? [genericOAuth({ config: genericProviders })] : []),
    ],
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        allowDifferentEmails: true,
        allowUnlinkingAll: false,
        disableImplicitLinking: true,
        enabled: true,
        trustedProviders: ["google", "kakao", "naver"],
        updateUserInfoOnLink: false,
      },
    },
    session: {
      cookieCache: { enabled: false },
      expiresIn: 60 * 60 * 24 * 7,
      freshAge: 60 * 60 * 24,
      updateAge: 60 * 60 * 24,
    },
    user: {
      deleteUser: { enabled: false },
    },
    verification: {
      storeIdentifier: "hashed",
    },
    rateLimit: {
      enabled: true,
      max: 60,
      storage: "database",
      window: 60,
      customRules: {
        "/sign-in/*": { max: 10, window: 60 },
        "/callback/*": { max: 20, window: 60 },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
