import type { CancellationSignal } from "@cloudflare-mobile-sync/client-core";

export interface SecureMobileAuthBrowserResult {
  type: string;
  url?: string;
}

export interface SecureMobileAuthResult {
  userId: string;
  expiresAt: string;
}

export interface SecureMobileAuthAdapter {
  signInWithGoogle(options: {
    callbackPath: string;
    signal?: CancellationSignal;
  }): Promise<SecureMobileAuthResult>;
  clearLocalSession(): Promise<void>;
}

export interface SecureMobileAuthAdapterOptions {
  audience: string;
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  generateVerifier(): Promise<string>;
  challenge(verifier: string): Promise<string>;
  createCallbackUrl(callbackPath: string, handoffId: string): string;
  beginGoogleSignIn(callbackUrl: string): Promise<string>;
  openAuthSession(
    authorizationUrl: string,
    callbackUrl: string,
  ): Promise<SecureMobileAuthBrowserResult>;
  dismissAuthSession?(): void | Promise<void>;
  storeSessionCookie(cookie: string): Promise<void>;
  clearSessionCookie?(): Promise<void>;
}

interface PreparedHandoff {
  handoffId: string;
  expiresAt: string;
}

interface ExchangedHandoff {
  sessionCookie: string;
  userId: string;
  expiresAt: string;
}

const TOKEN_PATTERN = /^[A-Fa-f0-9]{64}$/u;

export class MobileAuthCancelledError extends Error {
  constructor() {
    super("Mobile authentication was cancelled");
    this.name = "MobileAuthCancelledError";
  }
}

function assertHttpsBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("Secure mobile auth requires an HTTPS Worker URL");
  }
  return parsed.toString().replace(/\/$/u, "");
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new Error(`Mobile auth request failed (${response.status})`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Mobile auth response was not valid JSON");
  }
}

function preparedHandoff(value: unknown): PreparedHandoff {
  const candidate = value as Partial<PreparedHandoff> | null;
  if (
    !candidate ||
    typeof candidate.handoffId !== "string" ||
    !TOKEN_PATTERN.test(candidate.handoffId) ||
    typeof candidate.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.expiresAt))
  ) {
    throw new Error("Mobile auth prepare response was invalid");
  }
  return { handoffId: candidate.handoffId, expiresAt: candidate.expiresAt };
}

function exchangedHandoff(value: unknown): ExchangedHandoff {
  const candidate = value as Partial<ExchangedHandoff> | null;
  if (
    !candidate ||
    typeof candidate.sessionCookie !== "string" ||
    candidate.sessionCookie.length === 0 ||
    candidate.sessionCookie.includes("\n") ||
    candidate.sessionCookie.includes("\r") ||
    typeof candidate.userId !== "string" ||
    candidate.userId.length === 0 ||
    typeof candidate.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.expiresAt))
  ) {
    throw new Error("Mobile auth exchange response was invalid");
  }
  return {
    sessionCookie: candidate.sessionCookie,
    userId: candidate.userId,
    expiresAt: candidate.expiresAt,
  };
}

export function createSecureMobileAuthAdapter(
  options: SecureMobileAuthAdapterOptions,
): SecureMobileAuthAdapter {
  const baseUrl = assertHttpsBaseUrl(options.baseUrl);
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  const post = async (path: string, body: unknown, signal?: CancellationSignal) => {
    const controller = signal ? new AbortController() : undefined;
    const abort = () => controller?.abort();
    signal?.addEventListener?.("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      return await fetchImplementation(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "omit",
        ...(controller === undefined ? {} : { signal: controller.signal }),
      });
    } finally {
      signal?.removeEventListener?.("abort", abort);
    }
  };

  const cancel = async (handoffId: string, verifier: string): Promise<void> => {
    try {
      await post("/v1/mobile-auth/handoffs/cancel", {
        audience: options.audience,
        handoffId,
        verifier,
      });
    } catch {
      // Best effort: the ready handoff expires after 60 seconds and the Worker
      // revokes the unclaimed session during its next cleanup pass.
    }
  };

  const openAuthSession = async (
    authorizationUrl: string,
    expectedCallbackUrl: string,
    signal?: CancellationSignal,
  ): Promise<SecureMobileAuthBrowserResult> => {
    const browser = options.openAuthSession(authorizationUrl, expectedCallbackUrl);
    if (!signal) return browser;

    let abort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      let handled = false;
      abort = () => {
        if (handled) return;
        handled = true;
        if (options.dismissAuthSession) {
          void Promise.resolve(options.dismissAuthSession()).catch(() => undefined);
        }
        reject(new MobileAuthCancelledError());
      };
      signal.addEventListener?.("abort", abort, { once: true });
      if (signal.aborted) abort();
    });

    try {
      return await Promise.race([browser, aborted]);
    } finally {
      if (abort) signal.removeEventListener?.("abort", abort);
    }
  };

  return {
    async clearLocalSession(): Promise<void> {
      await options.clearSessionCookie?.();
    },

    async signInWithGoogle({ callbackPath, signal }): Promise<SecureMobileAuthResult> {
      if (signal?.aborted) throw new MobileAuthCancelledError();
      const verifier = await options.generateVerifier();
      const codeChallenge = await options.challenge(verifier);
      const prepared = preparedHandoff(
        await responseJson(
          await post(
            "/v1/mobile-auth/handoffs",
            { audience: options.audience, codeChallenge },
            signal,
          ),
        ),
      );
      const expectedCallbackUrl = options.createCallbackUrl(callbackPath, prepared.handoffId);
      const expectedCallback = new URL(expectedCallbackUrl);
      const expectedHandoffValues = expectedCallback.searchParams.getAll("mobile_handoff");
      if (
        expectedCallback.protocol !== `${options.audience}:` ||
        expectedCallback.username !== "" ||
        expectedCallback.password !== "" ||
        expectedCallback.hash !== "" ||
        [...expectedCallback.searchParams.keys()].length !== 1 ||
        expectedHandoffValues.length !== 1 ||
        expectedHandoffValues[0] !== prepared.handoffId
      ) {
        throw new Error("Expo produced an invalid mobile auth callback URL");
      }
      let storedSession = false;

      try {
        const authorizationUrl = await options.beginGoogleSignIn(expectedCallbackUrl);
        const browserResult = await openAuthSession(authorizationUrl, expectedCallbackUrl, signal);
        if (signal?.aborted || browserResult.type !== "success" || !browserResult.url) {
          throw new MobileAuthCancelledError();
        }

        const returnedUrl = new URL(browserResult.url);
        if (returnedUrl.searchParams.has("cookie")) {
          throw new Error("Unsafe bearer cookie was returned in a mobile callback");
        }
        const codeValues = returnedUrl.searchParams.getAll("code");
        const handoffValues = returnedUrl.searchParams.getAll("mobile_handoff");
        const returnedQueryKeys = [...returnedUrl.searchParams.keys()].sort();
        if (
          returnedUrl.protocol !== `${options.audience}:` ||
          returnedUrl.username !== "" ||
          returnedUrl.password !== "" ||
          returnedUrl.host !== expectedCallback.host ||
          returnedUrl.pathname !== expectedCallback.pathname ||
          returnedUrl.hash !== "" ||
          returnedQueryKeys.length !== 2 ||
          returnedQueryKeys[0] !== "code" ||
          returnedQueryKeys[1] !== "mobile_handoff" ||
          codeValues.length !== 1 ||
          !TOKEN_PATTERN.test(codeValues[0] ?? "") ||
          handoffValues.length !== 1 ||
          handoffValues[0] !== prepared.handoffId
        ) {
          throw new Error("Mobile auth callback was invalid");
        }

        const exchanged = exchangedHandoff(
          await responseJson(
            await post(
              "/v1/mobile-auth/handoffs/exchange",
              {
                audience: options.audience,
                handoffId: prepared.handoffId,
                code: codeValues[0],
                verifier,
              },
              signal,
            ),
          ),
        );
        if (signal?.aborted) throw new MobileAuthCancelledError();
        await options.storeSessionCookie(exchanged.sessionCookie);
        storedSession = true;
        if (signal?.aborted) throw new MobileAuthCancelledError();
        return { userId: exchanged.userId, expiresAt: exchanged.expiresAt };
      } catch (error) {
        if (storedSession && options.clearSessionCookie) {
          await options.clearSessionCookie().catch(() => undefined);
        }
        await cancel(prepared.handoffId, verifier);
        throw error;
      }
    },
  };
}
