# Architecture baseline

Status: owner Worker and D1 deployed; provider/device verification remains.

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
  `-- account inspection/deletion
                    |
                    v
Cloudflare D1
```

## Package boundaries

### `apps/worker`

- Hono Worker router
- Better Auth 1.6.23 with its first-party direct D1 binding
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
2. Use Better Auth 1.6.23 directly with D1; the extra `better-auth-cloudflare` adapter is unnecessary for this scope.
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

## Implementation status

1. Research, ADRs, workspace, portable packages, D1 migrations, sync API, CI, and secret scanning are complete.
2. Better Auth, Google, Kakao, Naver, Expo callback, session, logout, and deletion code paths are implemented.
3. Local Worker/D1 authorization, conflict, replay, tombstone, pagination, oversized input, and deletion tests pass.
4. The Expo example provides persistent guest notes, optional manual sync, explicit conflict resolution, and local-data preservation after remote account deletion.
5. The owner account's `workers.dev` Worker and production D1 database are
   deployed, all committed migrations are applied, and Google credentials and
   the Worker callback are configured. Real Google login in an Expo development
   build, Kakao/Naver setup, and iOS/Android verification remain.
6. The v1 retention, publication, conflict, and account-linking policies below are accepted. Real-provider/device verification and additional platform SDKs remain deferred.

## Accepted v1 lifecycle policies

- Retain tombstones and change history indefinitely. Do not add pruning until
  measured storage pressure justifies both a retention window and an explicit
  stale-device reset/snapshot protocol.
- Keep the repository and all workspace packages private and unpublished, with no
  open-source license. Reconsider publication only after one real host app and the
  supported providers pass end-to-end verification.
- Resolve conflicts with an explicit record-level choice: keep the local value or
  accept the server value. Do not auto-merge opaque JSON or add field-level merge
  rules in v1.
- Allow provider linking only from an authenticated session followed by fresh
  provider proof. Never link by matching email, and never unlink the last login
  method. A user who wants to remove every login method uses complete account
  deletion.

## Features deliberately deferred

- Cloudflare one-click deployment versus CLI-first installation
- R2/KV/Queues/Durable Objects; add only when a measured requirement exists
- Realtime push subscriptions
- Tombstone pruning and stale-device snapshots
- Automatic or field-level conflict merging
- A dedicated provider-link management UI
- Flutter, Swift, Android, and web SDKs
- Running a shared hosted service
