# HTTP API

Reviewed: 2026-07-20

All responses are JSON except successful account deletion, which returns an empty `204` response. Application-data endpoints use the Better Auth session established under `/v1/auth/*`. The Worker always derives the user ID from that session; a client-supplied user ID is invalid input.

## Endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET` | `/health` | no | D1 readiness and protocol version |
| any | `/v1/auth/*` | route-specific | Better Auth session and OAuth routes |
| `POST` | `/v1/sync/push` | yes | apply up to 25 ordered mutations |
| `GET` | `/v1/sync/pull` | yes | pull bounded changes after a cursor |
| `GET` | `/v1/account` | yes | current profile and linked providers |
| `DELETE` | `/v1/account` | fresh session | revoke provider grants and delete remote data |

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

Mutation IDs are idempotency identities, not request labels. Reusing one returns its originally stored result even if the retry body differs. A client must never intentionally reuse a mutation ID for another logical mutation.

## Pull

`GET /v1/sync/pull?cursor=0&limit=100`

```json
{
  "changes": [],
  "nextCursor": 0,
  "hasMore": false
}
```

Changes are ordered by a global monotonic cursor but selected by the authenticated user before pagination. Cursor gaps are normal and do not reveal other users. Continue from `nextCursor` while `hasMore` is true. Deletes appear as records with `deleted: true` and `payload: null`.

## Account response

The account endpoint returns only the current user and provider identifiers. Internal placeholder emails are returned as `null` with `emailIsPlaceholder: true`. Provider access and refresh tokens are never returned.

Remote deletion requires a session created within the previous 24 hours. Provider unlinking happens before the D1 user row is deleted. A provider outage returns a retryable error and keeps the database account available for another attempt.

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

The stable codes are `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_ERROR`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, and `INTERNAL_ERROR`. Client logic should use `code` and `retryable`, never parse the message.

Limits and exact runtime schemas live in `packages/api-contract/src/index.ts`. The protocol details and rejected alternatives are recorded in [ADR 0002](./adr/0002-sync-protocol.md).
