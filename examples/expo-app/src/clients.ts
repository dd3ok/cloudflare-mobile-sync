import { createExpoAuthClient, createExpoSyncClient } from "@cloudflare-mobile-sync/expo-client";

export const syncBaseUrl =
  process.env.EXPO_PUBLIC_SYNC_URL?.replace(/\/$/u, "") ?? "http://127.0.0.1:8787";

export const authClient = createExpoAuthClient({
  baseUrl: syncBaseUrl,
  scheme: "cloudflare-mobile-sync",
  storagePrefix: "cloudflare-mobile-sync-example",
});

export const syncClient = createExpoSyncClient({
  baseUrl: syncBaseUrl,
  authClient,
});
