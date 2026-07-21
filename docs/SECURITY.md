# Security model

Reviewed: 2026-07-21

## Trust boundaries

- The mobile app, its local database, all request fields, and all cursors are
  untrusted.
- The Worker is the authorization boundary. It validates the Better Auth session
  and derives the user ID before any application-data query.
- D1 and Worker secrets are trusted server-side resources. They are never exposed
  through the API or bundled into a client.
- OAuth providers are external dependencies. Their identifiers are normalized on
  the server and their profile attributes are not authorization inputs.

## Principal threats and controls

| Threat | Control |
| --- | --- |
| Cross-user record access | No API accepts `userId`; every record and change-log SQL statement includes the authenticated `user_id` predicate |
| Forged cursor probing | Cursors only select rows already scoped by `user_id`; a cursor reveals no other user's records |
| Silent account takeover through matching email | Implicit account linking is disabled; explicit linking needs an existing session and a fresh provider flow |
| OAuth callback interception | Exact trusted origins/callbacks, provider state/nonce/PKCE through maintained libraries, and stable application links in a compiled build |
| Stolen database snapshot | Provider tokens are encrypted; Worker and provider secrets are not stored in D1 |
| Mutation replay | `(user_id, mutation_id)` is unique and a replay returns the stored result without writing another change |
| Offline overwrite | Each mutation supplies `baseRevision`; a mismatch is a conflict, never an implicit overwrite |
| Oversized or malicious input | Runtime schemas plus request, batch, identifier, payload, page, and JSON-depth limits |
| Session theft or stale credentials | Server-side database sessions, explicit logout/revocation, no long-lived bearer token plugin, small SecureStore cache |
| Abuse and resource exhaustion | Per-route application limits, authenticated-user rate keys, provider/auth rate limits keyed from Cloudflare's trusted `CF-Connecting-IP` header, bounded D1 queries |
| Sensitive logging | Do not log request bodies, cookies, authorization headers, OAuth codes, provider profiles, or record payloads |
| Incomplete deletion | Provider grant removal precedes an atomic D1 cascade; deletion tests verify auth and sync rows are gone |

## Accepted v1 constraints

- This is a self-hosted single-adopter starter, not a shared multi-tenant service.
- There is no realtime transport, background queue, field-level merge, CRDT, or
  arbitrary server-side query language.
- Tombstones and change history are not pruned in v1. This avoids silently
  stranding stale devices. A future retention design must add an explicit reset
  protocol before pruning.
- Provider revocation is synchronous. A transient provider failure leaves the
  D1 account intact and returns a retryable error rather than deleting the only
  credential needed to finish revocation. With multiple providers, already
  completed external revocations cannot be rolled back; provider-specific
  idempotent responses make a later retry safe where documented, and real-provider
  failure testing remains a production gate.
- The initiating device keeps host-owned local data by default after deleting the
  remote account. The host app may separately offer a destructive local-data
  deletion action.
