import { expoClient } from "@better-auth/expo/client";
import {
  type CancellationSignal,
  createSyncClient,
  type RetryPolicy,
  SyncCancelledError,
  type SyncClient,
} from "@cloudflare-mobile-sync/client-core";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient, type ReactAuthClient } from "better-auth/react";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { validateMobileScheme } from "./mobile-scheme";

export interface ExpoAuthOptions {
  baseUrl: string;
  authPath?: string;
  scheme: string;
  storagePrefix: string;
}

type ExpoAuthClientConfiguration = {
  baseURL: string;
  basePath: string;
  plugins: [ReturnType<typeof expoClient>, ReturnType<typeof genericOAuthClient>];
};

export function createExpoAuthClient(
  options: ExpoAuthOptions,
): ReactAuthClient<ExpoAuthClientConfiguration> {
  validateMobileScheme(options.scheme);
  const plugins: ExpoAuthClientConfiguration["plugins"] = [
    expoClient({
      scheme: options.scheme,
      storage: SecureStore,
      storagePrefix: options.storagePrefix,
    }),
    genericOAuthClient(),
  ];
  return createAuthClient<ExpoAuthClientConfiguration>({
    baseURL: options.baseUrl,
    basePath: options.authPath ?? "/v1/auth",
    plugins,
  });
}

export function createExpoCallbackUrl(path = "auth/callback"): string {
  return Linking.createURL(path);
}

export interface ExpoSyncClientOptions {
  baseUrl: string;
  authClient: { getCookie(): string };
  fetch?: typeof globalThis.fetch;
  requestTimeoutMilliseconds?: number;
  retryPolicy?: Partial<RetryPolicy>;
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
  const requestTimeoutMilliseconds = options.requestTimeoutMilliseconds ?? 15_000;
  if (!Number.isFinite(requestTimeoutMilliseconds) || requestTimeoutMilliseconds <= 0) {
    throw new Error("requestTimeoutMilliseconds must be positive");
  }

  return createSyncClient({
    authHeaders: async () => {
      const cookie = options.authClient.getCookie();
      return cookie ? { Cookie: cookie } : {};
    },
    retry: {
      random: Math.random,
      sleep,
    },
    ...(options.retryPolicy === undefined ? {} : { retryPolicy: options.retryPolicy }),
    transport: {
      async send(request) {
        const response = await fetchWithTimeout(
          fetchImplementation,
          `${baseUrl}${request.path}`,
          {
            method: request.method,
            headers: request.headers,
            credentials: "omit",
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
          },
          requestTimeoutMilliseconds,
          request.signal,
        );
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
