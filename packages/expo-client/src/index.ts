import { expoClient, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import {
  type CancellationSignal,
  createSyncClient,
  type RetryPolicy,
  SyncCancelledError,
  type SyncClient,
} from "@cloudflare-mobile-sync/client-core";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient, type ReactAuthClient } from "better-auth/react";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { fetchWithTimeout } from "./fetch-with-timeout";
import { validateMobileScheme } from "./mobile-scheme";
import { createSecureMobileAuthAdapter, type SecureMobileAuthAdapter } from "./secure-mobile-auth";

export {
  MobileAuthCancelledError,
  type SecureMobileAuthAdapter,
  type SecureMobileAuthResult,
} from "./secure-mobile-auth";

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

export interface ExpoSecureMobileAuthOptions extends ExpoAuthOptions {
  authClient: ReturnType<typeof createExpoAuthClient>;
  fetch?: typeof globalThis.fetch;
}

function base64Url(value: string): string {
  return value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function createExpoSecureMobileAuth(
  options: ExpoSecureMobileAuthOptions,
): SecureMobileAuthAdapter {
  validateMobileScheme(options.scheme);
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  const basePath = options.authPath ?? "/v1/auth";
  const storage = storageAdapter(SecureStore);
  const cookieName = `${options.storagePrefix}_cookie`;

  return createSecureMobileAuthAdapter({
    audience: options.scheme,
    baseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    async generateVerifier() {
      const bytes = await Crypto.getRandomBytesAsync(32);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    },
    async challenge(verifier) {
      return base64Url(
        await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
          encoding: Crypto.CryptoEncoding.BASE64,
        }),
      );
    },
    createCallbackUrl(callbackPath, handoffId) {
      return Linking.createURL(callbackPath, {
        scheme: options.scheme,
        queryParams: { mobile_handoff: handoffId },
      });
    },
    async beginGoogleSignIn(callbackUrl) {
      const result = await options.authClient.signIn.social({
        provider: "google",
        callbackURL: callbackUrl,
        errorCallbackURL: callbackUrl,
        disableRedirect: true,
      });
      if (result.error) {
        throw new Error(result.error.message ?? "Google sign-in could not start");
      }
      const authorizationUrl = result.data?.url;
      if (typeof authorizationUrl !== "string") {
        throw new Error("Google sign-in did not return an authorization URL");
      }
      const authorization = new URL(authorizationUrl);
      if (authorization.protocol !== "https:" || authorization.origin === new URL(baseUrl).origin) {
        throw new Error("Google sign-in returned an unsafe authorization URL");
      }
      const proxy = new URL(`${baseUrl}${basePath}/expo-authorization-proxy`);
      proxy.searchParams.set("authorizationURL", authorization.toString());
      return proxy.toString();
    },
    async openAuthSession(authorizationUrl, callbackUrl) {
      return WebBrowser.openAuthSessionAsync(authorizationUrl, callbackUrl);
    },
    dismissAuthSession() {
      WebBrowser.dismissAuthSession();
    },
    async storeSessionCookie(cookie) {
      const previous = storage.getItem(cookieName);
      await storage.setItem(cookieName, getSetCookie(cookie, previous ?? undefined));
    },
    async clearSessionCookie() {
      await storage.setItem(cookieName, "{}");
    },
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
