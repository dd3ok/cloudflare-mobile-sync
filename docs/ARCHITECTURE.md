# Architecture baseline

## Product model

Cloudflare Mobile Sync is distributed as code. Each adopter deploys an independent Worker and D1 database to an account they control. The project does not operate a central shared service and does not receive adopter or end-user secrets.

The initial reference consumer is the Byulsata Expo application, but no domain-specific reading, astrology, saju, tarot, profile, or copy-generation model belongs in this repository.

## Boundary diagram

```text
Host application
  |-- local domain store (owned by the host app)
  |-- @cloudflare-mobile-sync/client-core
  `-- @cloudflare-mobile-sync/expo-client
          |-- SecureStore session persistence
          |-- deep-link callback handling
          `-- connectivity integration
                    |
                    | HTTPS only
                    v
Cloudflare Worker
  |-- request validation and versioned API
  |-- authentication/session handler
  |-- authorization boundary
  |-- sync conflict/idempotency handling
  `-- account export/deletion
                    |
                    v
Cloudflare D1
```

## Package boundaries

### `apps/worker`

- Hono-based or comparably small standards-based Worker router
- Better Auth integration using a maintained Cloudflare/D1 adapter
- OAuth callbacks and server-only provider credentials
- D1 migrations and query layer
- Ownership checks, input validation, rate limiting, security headers, structured errors, and privacy-safe logging
- Health/readiness endpoint and versioned `/v1` API

### `packages/api-contract`

- Runtime schemas and inferred TypeScript types
- Stable error envelope and error codes
- Sync push/pull request and response types
- No Worker, Node, browser, React Native, or Expo imports

### `packages/client-core`

- Platform-neutral HTTP transport and sync orchestration
- Injectable storage, clock, randomness, and network-state interfaces
- Retry/backoff, idempotency keys, cancellation, and typed errors
- No Expo, React, React Native, DOM, Node-only, or UI dependencies

### `packages/expo-client`

- Expo SDK 57-compatible SecureStore adapter
- App-scheme/universal-link callback handling
- Expo/mobile authentication integration
- Lifecycle and network adapters where necessary
- No provider client secrets and no direct D1 access

### `examples/expo-app`

- Minimal, non-Byulsata example
- Guest/local-only operation before login
- Login, logout, session restoration, record creation, sync, conflict demonstration, and complete account deletion
- Placeholder configuration only; never real credentials

## Authentication decisions

1. Do not implement OAuth, token signing, password hashing, PKCE, state, or nonce generation from scratch.
2. Evaluate current Better Auth and `better-auth-cloudflare` releases against current Cloudflare Workers/D1 support before selecting exact versions.
3. Implement and validate Google first as the reference provider.
4. Add Kakao and Naver through documented OIDC/generic OAuth mechanisms or small provider adapters. Keep provider-specific profile normalization server-side.
5. Identify accounts by the tuple of provider and provider subject/account ID. Email is profile data, not a globally trusted identity key.
6. Account linking must require an authenticated session plus fresh proof from the provider being linked. Do not silently link by matching email.
7. Mobile redirects must use exact allowlisted schemes/URLs and preserve OAuth CSRF protections.
8. Support logout, current-session revocation, all-session revocation, provider unlinking with lockout protection, account deletion, and deletion verification.

## Sync protocol baseline

The first protocol should be small and explainable rather than a general realtime database.

- Records are addressed by `(user_id, collection, record_id)`.
- The server derives `user_id` from the authenticated session; it is never accepted from a client payload.
- Payloads are opaque validated JSON with configurable size and collection allowlists.
- Writes include a client-generated mutation ID for idempotency.
- Server changes receive a monotonic cursor/revision suitable for incremental pull.
- Deletes create tombstones so offline devices can observe deletion.
- Pull is cursor-based and deterministically paginated.
- Push and pull may be separate endpoints or one bounded sync transaction, but retries must be safe.
- Conflict behavior must be explicit, deterministic, documented, and tested. Start with a conservative record-level policy; do not claim CRDT semantics without implementing them.
- Define tombstone retention and stale-device reset behavior before pruning deleted records.
- Do not upload raw host-app secrets or sensitive local profile data unless the host application deliberately opts in.

Candidate endpoints, subject to an ADR after implementation research:

```text
GET    /health
ALL    /v1/auth/*
POST   /v1/sync/push
GET    /v1/sync/pull?cursor=...&limit=...
GET    /v1/account
DELETE /v1/account
```

## Security invariants

- Deny by default when authentication, ownership, collection policy, or validation is uncertain.
- Bind every record operation to the authenticated user within the SQL statement or repository boundary.
- Test cross-user read, overwrite, delete, cursor probing, and mutation replay attempts.
- Enforce request body, payload, page-size, collection-name, record-ID, and batch-count limits.
- Allowlist production origins and callback URLs; do not ship wildcard credentialed CORS.
- Redact authorization headers, cookies, tokens, OAuth codes, birth data, record payloads, and provider profiles from logs.
- Rate-limit authentication and write-heavy routes with behavior that works in Cloudflare's distributed runtime.
- Return stable public errors without leaking SQL, provider tokens, stack traces, or account-existence details.
- Provide an auditable complete deletion path for auth rows, sessions, linked accounts, application records, tombstones, and derived data.

## First implementation phases

1. Research and ADRs: verify current official documentation, choose versions, settle session transport and sync conflict semantics.
2. Workspace scaffold: package manager, TypeScript configs, lint/format, unit tests, local Worker/D1 development, CI, and secret scanning.
3. Authentication vertical slice: Worker, local D1, Google login, Expo callback, session restoration, logout, and negative tests.
4. Sync vertical slice: migrations, one collection, idempotent push, cursor pull, tombstones, conflict tests, and cross-user isolation tests.
5. Expo SDK extraction: move portable logic to client-core and platform behavior to expo-client; complete the example app.
6. Korean providers: Kakao and Naver adapters, profile normalization, account-linking tests, provider failure handling, and documentation.
7. Operations and release: local/prod migration workflow, deployment guide, key rotation, deletion/export runbook, dependency/security audit, package/repository naming, and license decision.

## Decisions deliberately deferred

- Final package scope and npm publication
- Public repository visibility and open-source license
- Cloudflare one-click deployment versus CLI-first installation
- R2/KV/Queues/Durable Objects; add only when a measured requirement exists
- Realtime push subscriptions
- Flutter, Swift, Android, and web SDKs
- Running a shared hosted service
