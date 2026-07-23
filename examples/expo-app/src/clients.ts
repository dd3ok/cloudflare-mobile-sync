import { createExpoAuthClient, createExpoSyncClient } from "@cloudflare-mobile-sync/expo-client";

export const syncBaseUrl =
  process.env.EXPO_PUBLIC_MOBILE_SYNC_URL?.replace(/\/$/u, "") ?? "http://127.0.0.1:8787";

const supportedProviders = ["google", "kakao", "naver"] as const;
export type ProviderId = (typeof supportedProviders)[number];

const configuredProviders = new Set(
  (process.env.EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS ?? "")
    .split(",")
    .map((provider: string) => provider.trim().toLowerCase())
    .filter(Boolean),
);

export const enabledProviders: readonly ProviderId[] = supportedProviders.filter((provider) =>
  configuredProviders.has(provider),
);

export const authClient = createExpoAuthClient({
  baseUrl: syncBaseUrl,
  scheme: "com.example.cloudflaremobilesync",
  storagePrefix: "cloudflare-mobile-sync-example",
});

export const syncClient = createExpoSyncClient({
  baseUrl: syncBaseUrl,
  authClient,
});
