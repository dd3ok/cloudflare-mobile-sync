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
| OAuth callback interception | The Worker captures Better Auth's callback cookie, strips it from the private-scheme redirect, and releases it only through a 60-second, audience-bound, S256 verifier-bound, atomic one-time HTTPS exchange. Legacy cookie-query callbacks revoke the new session and fail closed. |
| Stolen database snapshot | Provider tokens are encrypted; Worker and provider secrets are not stored in D1 |
| Mutation replay | `(user_id, mutation_id)` is unique and a replay returns the stored result without writing another change |
| Deleted payload retained in sync history | An accepted delete keeps one payload-free tombstone, removes older same-record changes, clears finalized request payloads, and rewrites older receipt snapshots to that tombstone |
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
- The latest tombstone and compacted mutation identities are not pruned in v1,
  which prevents stranding stale devices or reapplying an old mutation. Older
  same-record change snapshots and all deleted receipt payloads are removed.
  Pruning the remaining metadata requires an explicit reset/epoch protocol.
- Provider revocation is synchronous and best-effort. A transient provider
  failure is logged by provider name only and does not block deletion of local
  D1 data. The starter intentionally does not retain provider tokens in a retry
  outbox. Google's revoke endpoint is confirmed only by its documented HTTP
  `200`; HTTP `400` and other statuses remain provider-revocation failures.
- A ready mobile handoff temporarily duplicates the signed Better Auth cookie in
  D1 until exchange or for no more than 60 seconds. A successful exchange clears
  that copy and the one-time code hash in the same transaction while retaining
  only verifier-bound cancellation metadata for the rest of the window. The
  authoritative session table already holds its raw bearer token. Reconstructing
  the cookie would depend on a non-public Better Auth signing API; ADR 0009
  records why the bounded copy is retained and how expiry/cancellation revoke an
  unclaimed or locally abandoned session.
- Private-scheme callbacks are reconstructed from an allowlisted shape. OAuth
  provider query extras and fragments are discarded server-side and rejected
  again by the Expo adapter.
- Retained tombstone compaction is limited to configured logical records and a
  strict payload-free lineage marker bound to the authenticated subject. An
  ordinary put cannot request compaction.
- Account-deletion receipts contain no account or provider subject, email, or
  token. Their operation and subject lookup keys are hashed and expire after
  seven days; both original capability values are required for recovery.
- Byulsataro environment files remain deliberately pending and fail preflight
  until separate Worker, D1, rate-limit, origin, Google OAuth, and secret values
  are provisioned. No checked-in sentinel configuration is release-ready.
- The initiating device keeps host-owned local data by default after deleting the
  remote account. The host app may separately offer a destructive local-data
  deletion action.

## Recovery-copy boundary

Live deletion and compaction do not purge D1 Time Travel. Cloudflare documents
that it is always enabled for 7 days on Workers Free or 30 days on Workers Paid.
Manual exports are separate copies and can live longer. No restored database may
serve traffic until deletion reconciliation and session invalidation complete.
See [sync retention operations](./SYNC_RETENTION.md).

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
