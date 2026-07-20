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
import { pullChanges, pushMutation } from "./sync-repository";

type Variables = { user: AuthenticatedUser };
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
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > LIMITS.requestBodyBytes) {
    throw new PublicError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PublicError(400, "VALIDATION_ERROR", "Request body must be valid JSON");
  }
}

function allowedCollections(env: Env): ReadonlySet<string> {
  return new Set(commaSeparated(env.ALLOWED_COLLECTIONS));
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const authenticate = dependencies.authenticate ?? defaultAuthenticate;

  app.use("*", async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Content-Type-Options", "nosniff");
  });

  app.get("/health", async (context) => {
    await context.env.DB.prepare("SELECT 1").first();
    return context.json({ ok: true, version: API_VERSION } as const);
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
    const rate = await context.env.SYNC_RATE_LIMITER.limit({ key: user.id });
    if (!rate.success) {
      throw new PublicError(429, "RATE_LIMITED", "Too many sync writes", true);
    }

    const parsed = pushRequestSchema.safeParse(await parseBody(context.req.raw));
    if (!parsed.success) {
      throw new PublicError(400, "VALIDATION_ERROR", "Invalid sync mutation request");
    }
    const allowed = allowedCollections(context.env);
    if (parsed.data.mutations.some((mutation) => !allowed.has(mutation.collection))) {
      throw new PublicError(403, "FORBIDDEN", "Collection is not allowed");
    }

    const results = [];
    for (const mutation of parsed.data.mutations) {
      results.push(await pushMutation(context.env.DB, user.id, mutation));
    }
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
      await revokeProvidersAndDelete(context.env, auth, user, context.req.raw.headers);
    }
    return context.body(null, 204);
  });

  app.notFound((context) =>
    context.json(errorEnvelope(new PublicError(404, "NOT_FOUND", "Route not found")), 404),
  );

  app.onError((error, context) => {
    const publicError =
      error instanceof PublicError
        ? error
        : new PublicError(500, "INTERNAL_ERROR", "Internal server error", true);
    return context.json(errorEnvelope(publicError), publicError.status as ContentfulStatusCode);
  });

  return app;
}
