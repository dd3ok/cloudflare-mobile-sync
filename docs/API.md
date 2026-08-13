# HTTP API

Reviewed: 2026-08-13

Responses are JSON except routes explicitly documented as `204`. Successful account deletion returns a recoverable JSON receipt with provider-revocation confirmation status. Application-data endpoints use the Better Auth session established under `/v1/auth/*`. The Worker always derives the user ID from that session; a client-supplied user ID is invalid input.

## Endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | no | D1 readiness and protocol version |
| any | `/v1/auth/*` | route-specific | Better Auth session and OAuth routes |
| `POST` | `/v1/mobile-auth/handoffs` | no; rate-limited | prepare an exact-audience S256 mobile handoff |
| `POST` | `/v1/mobile-auth/handoffs/exchange` | one-time proof | exchange a 60-second code and verifier over HTTPS |
| `POST` | `/v1/mobile-auth/handoffs/cancel` | handoff verifier | cancel and revoke an unclaimed mobile session |
| `POST` | `/v1/sync/push` | yes | apply up to 25 ordered mutations |
| `POST` | `/v1/sync/retained-tombstone` | yes | CAS a configured non-sensitive marker and scrub superseded payloads |
| `GET` | `/v1/sync/pull` | yes | pull bounded changes after a cursor, optionally for one exact collection |
| `GET` | `/v1/account` | yes | current profile and linked providers |
| `DELETE` | `/v1/account` | fresh session | revoke provider grants, delete remote data, and return a recovery receipt |
| `POST` | `/v1/account-deletions/status` | deletion capability | recover a completed deletion after response loss |

`/health` returns `{ "ok": true, "version": "v1" }` after a successful D1
probe. It does not expose configuration, secrets, or a build revision. The
current manual release flow cannot prove that a locally computed revision
identifies the uploaded artifact; see the deferred deployment-metadata decision
in [operations](./OPERATIONS.md).

## Push

```json
{
  "mutations": [
    {
      "mutationId": "device01-000001",
      "collection": "notes",
      "recordId": "note-123",
      "operation": "put",
      "baseRevision": 0,
      "payload": { "title": "Packing list" }
    }
  ]
}
```

A create uses `baseRevision: 0`. Later puts and deletes must use the exact current revision. The endpoint returns an ordered result for every mutation. A record conflict is represented inside a successful batch response so independent mutations are not discarded:

```json
{
  "results": [
    {
      "mutationId": "device01-000002",
      "status": "conflict",
      "replayed": false,
      "current": {
        "collection": "notes",
        "recordId": "note-123",
        "revision": 2,
        "cursor": 14,
        "deleted": false,
        "payload": { "title": "Server copy" },
        "updatedAt": "2026-07-20T12:00:00.000Z"
      }
    }
  ]
}
```

Mutation IDs are idempotency identities, not request labels. Reusing one returns
its stored status without applying another write even if the retry body differs.
After that logical record is deleted, privacy compaction replaces every older
receipt snapshot with the latest tombstone; replay cannot recover the deleted
payload. A client must never intentionally reuse a mutation ID for another
logical mutation.

The 25-mutation maximum remains compatible with existing clients. A push uses at
most 25 insert statements plus one receipt query, leaving room for session
queries under the Cloudflare D1 free-tier per-invocation query budget. All
statements are submitted as one transactional D1 batch, preserving request
order. If one batch puts and then deletes the same record, the earlier accepted
result can already contain the final tombstone because deletion compaction runs
before the receipt query.

## Pull

`GET /v1/sync/pull?cursor=0&limit=50`

To query one exact allowlisted collection, add `collection`:

`GET /v1/sync/pull?cursor=0&limit=50&collection=saved-readings-v1`

```json
{
  "changes": [],
  "nextCursor": 0,
  "hasMore": false
}
```

Changes are ordered by a global monotonic cursor but selected by the
authenticated user before pagination. An optional collection filter is exact,
allowlist-checked, and applied in SQL before the page limit. Cursor gaps are
normal and do not reveal other users. Continue from `nextCursor` while
`hasMore` is true. A filtered collection is a separate feed: start it at cursor
zero, persist its own `nextCursor`, and never seed it with an unfiltered or
different collection's cursor.

Deletes appear as records with `deleted: true` and `payload: null`. The server
keeps the latest tombstone but erases older change snapshots for that logical
record, so even a device starting from an older cursor sees the deletion without
receiving the deleted content.

A configured consumer whose erasure marker must remain a normal sync record
uses `/v1/sync/retained-tombstone`, not an ordinary put. Its strict marker is
CAS-applied, remains pullable for offline devices, and transactionally replaces
older change and receipt payloads for only that authenticated collection and
record. See ADR 0011.

The default page size is 50 and the maximum is 100. With a 64 KiB per-record
payload ceiling this keeps one worst-case page bounded for mobile clients.

## Account response

The account endpoint returns only the current user and provider identifiers. Internal placeholder emails are returned as `null` with `emailIsPlaceholder: true`. Provider access and refresh tokens are never returned.

Remote deletion requires a session created within the previous 24 hours and an
`X-Mobile-Sync-Expected-Subject` header equal to that authenticated session's
user ID. A missing or changed expected subject returns `409` before deletion.
It also requires `X-Mobile-Sync-Deletion-Operation`, a UUID-v4 created and
durably journaled before the request. Success is JSON containing
`serverDataDeleted: true`, a completion time, and PII-free per-provider
`confirmed`/`unconfirmed` revocation statuses. The status endpoint accepts the
operation ID and expected subject in a strict JSON body for seven-day
response-loss recovery; a mismatch is indistinguishable from a missing receipt.
Provider unlinking is attempted before the D1 user row is deleted. A provider
outage is recorded without user data or tokens and does not block deletion of
the local account.

## Public errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid sync mutation request",
    "retryable": false
  }
}
```

The stable codes are `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `INTERNAL_ERROR`. Client logic should use `code` and `retryable`, never parse the message.

Limits and exact runtime schemas live in `packages/api-contract/src/index.ts`.
The base protocol is recorded in [ADR 0002](./adr/0002-sync-protocol.md), and
deletion compaction plus filtered-cursor semantics are recorded in
[ADR 0010](./adr/0010-sync-deletion-compaction-and-filtered-pull.md).
