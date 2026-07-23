import {
  API_VERSION,
  LIMITS,
  pullQuerySchema,
  pushRequestSchema,
} from "@cloudflare-mobile-sync/api-contract";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { type AuthenticatedUser, getAccount, revokeProvidersAndDelete } from "./account";
import { createAuth } from "./auth";
import { commaSeparated, type Env } from "./env";
import { errorEnvelope, PublicError } from "./errors";
import { pullChanges, pushMutations } from "./sync-repository";

type Variables = { requestId: string; user: AuthenticatedUser };
type Authenticate = (request: Request, env: Env) => Promise<AuthenticatedUser | null>;
type DeleteAccount = (request: Request, env: Env, user: AuthenticatedUser) => Promise<void>;

export interface AppDependencies {
  authenticate?: Authenticate;
  deleteAccount?: DeleteAccount;
}

async function defaultAuthenticate(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const result = await createAuth(env).api.getSession({ headers: request.headers });
  if (!result) return null;
  return {
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
    image: result.user.image ?? null,
    sessionCreatedAt: result.session.createdAt,
  };
}

async function parseBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > LIMITS.requestBodyBytes) {
    throw new PublicError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let receivedBytes = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > LIMITS.requestBodyBytes) {
          await reader.cancel().catch(() => undefined);
          throw new PublicError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
        }
        parts.push(decoder.decode(chunk.value, { stream: true }));
      }
      parts.push(decoder.decode());
    } finally {
      reader.releaseLock();
    }
  }
  const text = parts.join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicError(400, "VALIDATION_ERROR", "Request body must be valid JSON");
  }
}

function allowedCollections(env: Env): ReadonlySet<string> {
  return new Set(commaSeparated(env.ALLOWED_COLLECTIONS));
}

async function consumeRateLimit(
  limiter: RateLimit,
  key: string,
  units: number,
  message: string,
): Promise<void> {
  for (let unit = 0; unit < units; unit += 1) {
    const result = await limiter.limit({ key });
    if (!result.success) throw new PublicError(429, "RATE_LIMITED", message, true);
  }
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const authenticate = dependencies.authenticate ?? defaultAuthenticate;

  app.use("*", async (context, next) => {
    const cloudflareRay = context.req.header("cf-ray")?.trim();
    const requestId =
      cloudflareRay && /^[A-Za-z0-9-]{1,64}$/u.test(cloudflareRay)
        ? cloudflareRay
        : crypto.randomUUID();
    context.set("requestId", requestId);
    try {
      await next();
    } finally {
      context.header("Cache-Control", "no-store");
      context.header("Referrer-Policy", "no-referrer");
      context.header("X-Content-Type-Options", "nosniff");
      context.header("X-Request-ID", requestId);
    }
  });

  app.get("/health", async (context) => {
    await context.env.DB.prepare("SELECT 1").first();
    return context.json({ ok: true, version: API_VERSION } as const);
  });

  app.use("/v1/auth/*", async (context, next) => {
    const clientIp = context.req.header("cf-connecting-ip")?.trim() || "unknown";
    await consumeRateLimit(
      context.env.AUTH_RATE_LIMITER,
      clientIp,
      1,
      "Too many authentication requests",
    );
    await next();
  });
  app.all("/v1/auth/*", (context) => createAuth(context.env).handler(context.req.raw));

  app.use("/v1/sync/*", async (context, next) => {
    const user = await authenticate(context.req.raw, context.env);
    if (!user) throw new PublicError(401, "UNAUTHORIZED", "Authentication required");
    context.set("user", user);
    await next();
  });
  app.use("/v1/account", async (context, next) => {
    const user = await authenticate(context.req.raw, context.env);
    if (!user) throw new PublicError(401, "UNAUTHORIZED", "Authentication required");
    context.set("user", user);
    await next();
  });

  app.post("/v1/sync/push", async (context) => {
    const user = context.get("user");
    const parsed = pushRequestSchema.safeParse(await parseBody(context.req.raw));
    if (!parsed.success) {
      throw new PublicError(400, "VALIDATION_ERROR", "Invalid sync mutation request");
    }
    const allowed = allowedCollections(context.env);
    if (parsed.data.mutations.some((mutation) => !allowed.has(mutation.collection))) {
      throw new PublicError(403, "FORBIDDEN", "Collection is not allowed");
    }
    await consumeRateLimit(
      context.env.SYNC_RATE_LIMITER,
      `push:${user.id}`,
      parsed.data.mutations.length,
      "Too many sync writes",
    );

    const results = await pushMutations(context.env.DB, user.id, parsed.data.mutations);
    return context.json({ results });
  });

  app.get("/v1/sync/pull", async (context) => {
    const parsed = pullQuerySchema.safeParse({
      cursor: context.req.query("cursor"),
      limit: context.req.query("limit"),
    });
    if (!parsed.success) {
      throw new PublicError(400, "VALIDATION_ERROR", "Invalid pull cursor or page limit");
    }
    await consumeRateLimit(
      context.env.SYNC_RATE_LIMITER,
      `pull:${context.get("user").id}`,
      1,
      "Too many sync reads",
    );
    return context.json(
      await pullChanges(
        context.env.DB,
        context.get("user").id,
        parsed.data.cursor,
        parsed.data.limit,
      ),
    );
  });

  app.get("/v1/account", async (context) =>
    context.json(await getAccount(context.env.DB, context.get("user"))),
  );

  app.delete("/v1/account", async (context) => {
    const user = context.get("user");
    if (Date.now() - user.sessionCreatedAt.getTime() > 24 * 60 * 60 * 1_000) {
      throw new PublicError(401, "UNAUTHORIZED", "A fresh login is required");
    }
    if (dependencies.deleteAccount) {
      await dependencies.deleteAccount(context.req.raw, context.env, user);
    } else {
      const auth = createAuth(context.env);
      const outcome = await revokeProvidersAndDelete(
        context.env,
        auth,
        user,
        context.req.raw.headers,
      );
      if (outcome.providerRevocationFailures.length > 0) {
        console.warn("Account deleted after provider revocation failed", {
          providers: outcome.providerRevocationFailures,
          requestId: context.get("requestId"),
        });
      }
    }
    return context.body(null, 204);
  });

  app.notFound((context) =>
    context.json(errorEnvelope(new PublicError(404, "NOT_FOUND", "Route not found")), 404),
  );

  app.onError((error, context) => {
    if (!(error instanceof PublicError)) {
      console.error("Unhandled request error", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        method: context.req.method,
        path: new URL(context.req.url).pathname,
        requestId: context.get("requestId"),
      });
    }
    const publicError =
      error instanceof PublicError
        ? error
        : new PublicError(500, "INTERNAL_ERROR", "Internal server error", true);
    return context.json(errorEnvelope(publicError), publicError.status as ContentfulStatusCode);
  });

  return app;
}
