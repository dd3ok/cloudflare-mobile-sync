import { expoClient } from "@better-auth/expo/client";
import {
  type CancellationSignal,
  createSyncClient,
  SyncCancelledError,
  type SyncClient,
} from "@cloudflare-mobile-sync/client-core";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";

export interface ExpoAuthOptions {
  baseUrl: string;
  authPath?: string;
  scheme: string;
  storagePrefix: string;
}

export function createExpoAuthClient(options: ExpoAuthOptions) {
  return createAuthClient({
    baseURL: options.baseUrl,
    basePath: options.authPath ?? "/v1/auth",
    plugins: [
      expoClient({
        scheme: options.scheme,
        storage: SecureStore,
        storagePrefix: options.storagePrefix,
      }),
      genericOAuthClient(),
    ],
  });
}

export function createExpoCallbackUrl(path = "auth/callback"): string {
  return Linking.createURL(path);
}

export interface ExpoSyncClientOptions {
  baseUrl: string;
  authClient: { getCookie(): string };
  fetch?: typeof globalThis.fetch;
}

function sleep(milliseconds: number, signal?: CancellationSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SyncCancelledError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, milliseconds);

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(new SyncCancelledError());
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

export function createExpoSyncClient(options: ExpoSyncClientOptions): SyncClient {
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  return createSyncClient({
    authHeaders: async () => {
      const cookie = options.authClient.getCookie();
      return cookie ? { Cookie: cookie } : {};
    },
    retry: {
      random: Math.random,
      sleep,
    },
    transport: {
      async send(request) {
        const response = await fetchImplementation(`${baseUrl}${request.path}`, {
          method: request.method,
          headers: request.headers,
          credentials: "omit",
          ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          ...(request.signal === undefined ? {} : { signal: request.signal as AbortSignal }),
        });
        const text = await response.text();
        let body: unknown = null;
        if (text.length > 0) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        return { status: response.status, body };
      },
    },
  });
}
