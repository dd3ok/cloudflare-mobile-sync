# Security model

Reviewed: 2026-08-13

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
| Concurrent provider-identity claim | D1 uniquely constrains `(providerId, accountId)` across local users; a race fails closed |
| OAuth callback interception | **Not acceptably mitigated for a public Android cloud release.** State/nonce/PKCE protect the authorization code flow, but Better Auth Expo currently returns the bearer session cookie in a private-scheme callback query. A reverse-domain scheme is not OS-owned on Android. Keep public mobile auth disabled until an app-bound HTTPS callback or one-time, audience-bound session exchange is implemented and tested. |
| Stolen database snapshot | Provider tokens are encrypted; Worker and provider secrets are not stored in D1 |
| Mutation replay | `(user_id, mutation_id)` is unique and a replay returns the stored result without writing another change |
| Offline overwrite | Each mutation supplies `baseRevision`; a mismatch is a conflict, never an implicit overwrite |
| Oversized or malicious input | Runtime schemas plus request, batch, identifier, payload, page, and JSON-depth limits |
| Session theft or stale credentials | Server-side database sessions, explicit logout/revocation, no long-lived bearer token plugin, small SecureStore cache |
| Abuse and resource exhaustion | A coarse Cloudflare auth limiter uses the trusted `CF-Connecting-IP` header; Better Auth keeps only bounded isolate-local fallback counters instead of attacker-controlled D1 rows; sync writes are charged per mutation and reads per request; all D1 queries are bounded |
| Sensitive logging | Do not log request bodies, cookies, authorization headers, OAuth codes, provider profiles, or record payloads |
| Incomplete deletion | Provider grant removal is attempted before an atomic D1 cascade, but an external outage cannot block deletion; deletion tests verify auth and sync rows are gone |

## Accepted v1 constraints

- This is a self-hosted single-adopter starter, not a shared multi-tenant service.
- The maintainer deployment is not a public sandbox. Every unrelated adopter
  uses an isolated Worker, D1 database, provider applications, and secrets.
- There is no realtime transport, background queue, field-level merge, CRDT, or
  arbitrary server-side query language.
- Tombstones and change history are not pruned in v1. This avoids silently
  stranding stale devices. A future retention design must add an explicit reset
  protocol before pruning.
- Provider revocation is synchronous and best-effort. A transient provider
  failure is logged by provider name only and does not block deletion of local
  D1 data. The starter intentionally does not retain provider tokens in a retry
  outbox. Google's revoke endpoint is confirmed only by its documented HTTP
  `200`; HTTP `400` and other statuses remain provider-revocation failures.
- Better Auth Expo 1.6.23 hands the session cookie to a non-HTTP mobile callback
  as a query parameter. Reverse-domain schemes reduce accidental/malicious
  scheme collision but cannot provide the OS ownership guarantee of a claimed
  HTTPS link. Claimed HTTPS is not a drop-in option because the maintained
  plugin does not attach the cookie to HTTP(S) redirects. This project does not
  implement a custom one-time session exchange.
- The initiating device keeps host-owned local data by default after deleting the
  remote account. The host app may separately offer a destructive local-data
  deletion action.

## Temporary dependency-audit exceptions

Reviewed: 2026-08-12

`pnpm security:audit` temporarily ignores only
`GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq`. Both advisories affect
`image-size`; the npm registry has no fixed release as of 2026-08-12 even though
some audit output names an unpublished `2.0.3` version.

The dependency is reachable only through the Expo SDK 57 development toolchain
(`@react-native/community-cli-plugin > metro > image-size`), not the deployed
Worker bundle. Repository-controlled development assets must remain trusted
while the exception is active. The exceptions expire on 2026-09-12 UTC, when
the audit command will fail until the maintainer rechecks upstream, installs a
real fixed release, or explicitly renews the review with current evidence.
