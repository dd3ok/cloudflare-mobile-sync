# Detailed handoff prompt

Copy the prompt below into a new Codex task opened with this repository as the workspace.

---

You are taking over the initial implementation of `dd3ok/cloudflare-mobile-sync`.

## Mission

Build a secure, self-hosted, platform-neutral authentication and incremental-sync backend on Cloudflare Workers and D1. Each adopter must deploy an isolated instance to their own Cloudflare account. The first supported client is Expo SDK 57, but the Worker protocol and core client must not depend on Expo. The Byulsata app will eventually consume the Expo package, but this repository must contain no astrology, saju, tarot, birth-profile, or other Byulsata-specific domain code.

The owner authorized preparation of an MIT-licensed public source release on
2026-07-21. This does not authorize a shared hosted service, npm publication, or
changing repository visibility without completing `docs/PUBLIC_RELEASE.md`.

The repository begins as documentation only. Read all tracked files before acting, especially `AGENTS.md`, `README.md`, and `docs/ARCHITECTURE.md`. Inspect Git history and worktree state. Preserve user changes and never introduce or print secrets.

## Required research before code

1. Read the exact Expo SDK 57 documentation at <https://docs.expo.dev/versions/v57.0.0/> for any Expo APIs you will use, especially linking, browser/auth flow, SecureStore, app configuration, and local/development behavior.
2. Verify the current official Cloudflare documentation for Workers, D1 bindings, Wrangler configuration, local D1, migrations, test tooling, resource limits, secrets, and deployment.
3. Verify current official Better Auth documentation and releases, Better Auth's Expo integration, generic OAuth/OIDC support, and current Cloudflare/D1 compatibility.
4. Verify Google, Kakao, and Naver's official authentication documentation, callback requirements, identifiers, scopes, token handling, unlinking, and provider-specific account/deletion behavior.
5. Record meaningful choices and rejected alternatives in short ADRs under `docs/adr/`. Cite official sources and pin the date reviewed.

Do not rely on unversioned Expo examples, stale blog posts, or memory when official documentation exists.

## Architecture to preserve

Create a TypeScript workspace with these conceptual boundaries; adjust names only with a documented reason:

```text
apps/worker               Cloudflare Worker HTTP API and D1 access
packages/api-contract     runtime schemas plus portable types
packages/client-core      platform-independent API/sync client
packages/expo-client      Expo SDK 57 SecureStore/linking/auth adapter
examples/expo-app         minimal end-to-end example
docs                      ADRs, security model, API and operations guides
```

The backend must be usable through ordinary HTTPS by future Flutter, Swift, Android, web, and bare React Native clients. `api-contract` and `client-core` must not import Expo, React, React Native, DOM, Node-only, or Cloudflare runtime modules. Use dependency injection for storage, transport, clock, randomness, and connectivity when necessary.

The Expo package is the first adapter, not the architecture's center.

## Mandatory security rules

- Mobile clients never connect directly to D1.
- OAuth client secrets, Cloudflare credentials, session signing secrets, provider refresh tokens, and server encryption keys stay in Worker secrets only.
- Do not implement cryptographic or OAuth primitives yourself. Use maintained, documented libraries.
- The Worker derives the user ID from the validated session. No client request may choose or override a user ID.
- Every application-data read and write must be scoped to the authenticated user, ideally at the SQL/repository boundary as well as the route boundary.
- Do not link provider accounts solely because email addresses match. Linking requires an existing authenticated session and fresh proof from the new provider.
- Preserve state, nonce, PKCE, exact redirect allowlists, and other applicable OAuth protections.
- Deny by default. Do not use wildcard credentialed CORS in production.
- Put authentication and mutation rate limits in place with Cloudflare-runtime-compatible behavior.
- Validate collection names, record IDs, schema versions, batch counts, page limits, request sizes, and JSON payload sizes.
- Do not log tokens, cookies, authorization headers, OAuth codes, provider profiles, record payloads, or sensitive host-app data.
- Support logout, session revocation, safe provider unlinking, full account deletion, and verification that related records are removed.
- Add automated negative tests for cross-user reads, cursor probing, overwrite/delete attempts, replayed mutations, forged identifiers, malformed input, oversized input, and deleted sessions.

If a selected authentication dependency cannot satisfy these rules on Expo and Workers without fragile workarounds, stop that implementation path, document the evidence, and choose a safer supported approach.

## Authentication scope and order

1. Evaluate and pin compatible current versions of Better Auth, its Expo package, and a maintained Cloudflare/D1 adapter such as `better-auth-cloudflare`. Do not blindly install `latest`; inspect release/security notes and commit the lockfile.
2. Build Google as the first complete vertical slice: start login from the Expo example, return through an allowlisted mobile deep link, establish and persist the supported session form, restore the session after restart, call an authenticated endpoint, log out, and revoke sessions.
3. Create a provider-normalization boundary keyed by `(provider, providerSubject)`. Treat email as mutable profile data.
4. Add Kakao and Naver only after the Google slice and shared provider tests are stable. Prefer documented OIDC/generic OAuth support; keep unavoidable provider-specific mapping in small server-only adapters.
5. Test explicit account linking, duplicate-provider accounts, denied consent, cancelled login, expired/revoked tokens, provider downtime, mismatched callbacks, and unlinking the last available login method.

Do not require login for an adopting app's local-only functionality. Authentication enables remote sync; it is not a prerequisite for local use.

## Sync v1 requirements

Implement an intentionally small record synchronization protocol, not a realtime Firebase clone.

- Logical identity: `(authenticated user, collection, recordId)`.
- Payload: opaque but runtime-validated JSON with configurable allowlists and limits.
- Idempotency: every pushed mutation has a client-generated mutation ID; retrying it cannot duplicate or corrupt a record.
- Incremental pull: every accepted change receives a deterministic monotonic server cursor/revision and can be fetched in bounded pages after a cursor.
- Deletion: use tombstones so an offline device sees remote deletion.
- Conflict behavior: choose one conservative record-level rule, document it precisely, and test simultaneous edits. Do not claim CRDT or field-level merging unless actually implemented.
- Stale devices: document how a client recovers when its cursor predates tombstone retention.
- Retry: implement bounded exponential backoff with jitter and cancellation; distinguish retryable transport/server failures from permanent validation/auth failures.
- Limits: bound push batch size, pull page size, payload size, collection length, record-ID length, and mutation-ID length.
- Privacy: host applications opt in to fields uploaded. Do not assume raw profiles, birth information, or generated copy should be synchronized.

Candidate API surface, to confirm in an ADR:

```text
GET    /health
ALL    /v1/auth/*
POST   /v1/sync/push
GET    /v1/sync/pull?cursor=...&limit=...
GET    /v1/account
DELETE /v1/account
```

Use stable versioned error envelopes. Never expose SQL errors, stack traces, secrets, raw provider responses, or whether an unrelated account exists.

## Data and migration expectations

- Keep Better Auth-managed tables separated conceptually from application sync tables even if they share D1.
- Use versioned SQL migrations committed to the repository.
- Apply and test migrations against disposable local D1 state first.
- Add indexes justified by actual query shapes: authenticated user plus collection/record lookup, incremental cursor pulls, and mutation-id idempotency.
- Define foreign-key and deletion behavior deliberately; verify full deletion in tests.
- Do not add KV, R2, Queues, Durable Objects, analytics, or telemetry until a measured requirement or documented security need exists.

## Tooling and quality gates

- Use a maintained package manager/workspace setup and commit its lockfile.
- Establish strict TypeScript, formatting, linting, unit tests, Worker integration tests with disposable D1, and CI.
- Add dependency review/updates and secret scanning appropriate for a private repository without requiring paid services.
- Ensure example environment files contain only placeholders.
- Provide commands for install, type-check, lint, test, local migration, local Worker execution, and build.
- Test the Expo example on the platforms possible in the environment. Clearly report anything requiring a physical device, provider console, signing credential, or user action rather than claiming it passed.
- Keep runtime bundles and dependencies lean; justify Node compatibility flags or heavy adapters.

## Work phases and commit discipline

Proceed in small reviewable phases. At minimum:

1. Research, compatibility matrix, threat model, and ADRs.
2. Workspace, Worker/D1 local development, migrations, validation, test, and CI scaffold.
3. Google authentication vertical slice plus Expo session/deep-link behavior.
4. Generic sync vertical slice plus authorization and failure tests.
5. Extract and document `client-core` and `expo-client`; complete the neutral example app.
6. Kakao and Naver adapters plus account-linking/deletion tests.
7. Deployment, key rotation, migration, backup/restore, deletion, troubleshooting, and eventual-publication documentation.

Make coherent conventional commits after verified phases. Do not combine unrelated refactors. Do not deploy production Cloudflare resources, create OAuth applications, publish npm packages, change repository visibility, or add an open-source license without explicit owner authorization.

## Definition of done for the initial implementation

The initial milestone is complete only when:

- A fresh clone can install and run all checks using documented commands.
- The Worker and a disposable D1 database run locally with reproducible migrations.
- API schemas are runtime validated and shared through the portable contract package.
- Authentication architecture is documented and the maximum feasible Google flow is verified without fabricating unavailable provider credentials.
- Sync push/pull/delete works locally, is idempotent, has deterministic cursor pagination, and passes conflict/tombstone tests.
- Cross-user isolation and other mandatory negative tests pass.
- The Expo SDK uses Expo SDK 57-compatible documented APIs and keeps secrets out of the app bundle.
- The example supports local guest records and optional authenticated synchronization.
- Account/session deletion behavior is implemented and tested locally.
- Kakao/Naver status is explicit: implemented and verified, implemented awaiting real credentials/device verification, or blocked with official evidence and a safe next step.
- Documentation explains self-hosted deployment to the adopter's own Cloudflare account and clearly states that this project does not operate a shared service.
- `git status` is clean and the final report lists commits, commands/tests run, unverified device/provider steps, security assumptions, and remaining work.

## First action

Start by reading the repository, checking its Git state, and creating a short execution plan. Then perform the required official-document research and write the compatibility/threat-model ADRs before scaffolding code. Continue autonomously through safe local work; request input only when credentials, provider-console actions, production deployment authorization, repository visibility, licensing, or another consequential owner decision is genuinely required.

---
