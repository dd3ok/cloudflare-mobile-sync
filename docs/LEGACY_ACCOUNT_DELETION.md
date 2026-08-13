# Legacy account-deletion operator runbook

Reviewed: 2026-08-13

This runbook is for a deletion request sent by a former internal-test user who
cannot use the old host app. It deletes one verified account from the live D1
service. It does not authorize deletion from a shared database, bulk deletion,
provider impersonation, a Time Travel restore, or deletion of a D1 database.

The preferred path remains self-service `DELETE /v1/account` after a fresh
login. The support path below exists only for a legacy user who cannot reach
that path.

This document alone does not make the email path operational. Do not claim the
published deletion promise is ready until the roles, parameter-bound tool,
receipt/HMAC store, backup inventory, and a rehearsal against a disposable
database all exist and have been independently reviewed.

## What the service actually supports

- `GET /v1/account` returns only the currently authenticated account.
- `DELETE /v1/account` deletes only the currently authenticated account and
  requires a session created within the previous 24 hours.
- There is no administrator endpoint, email-lookup endpoint, deletion operation
  ID, deletion-status endpoint, or operator impersonation flow.
- The API returns an empty `204` after live deletion. It does not return a
  durable per-provider revocation result. A `204` is therefore not proof that a
  Google grant was revoked.
- The live deletion statement is `DELETE FROM user WHERE id = ?`. Foreign-key
  cascades delete that user's `session`, `account`, `sync_records`,
  `sync_mutations`, and `sync_changes` rows.
- `verification` and `rateLimit` have no user foreign key. Do not guess that a
  row in either table belongs to the requester, and do not delete either table
  or a broad subset as part of this procedure.

Email is profile data and a candidate selector, not the account identity or the
deletion key. The exact provider identity is `(providerId, accountId)`, and the
exact local deletion key is `user.id`.

## Preconditions and roles

Open a case in a restricted operations system. Do not copy the request into an
issue, repository, chat room, analytics product, or general-purpose task board.
Use a random case ID that contains no email address or user identifier.

Two distinct people should fill these roles:

1. **Verifier** — performs mailbox verification and the read-only lookup.
2. **Approver/executor** — independently checks the database identity, target
   fingerprint, query shape, scope counts, and user confirmation before the
   write.

An acceptable equivalent is an approved operator tool that cryptographically
binds a second principal's approval to the database ID, target fingerprint,
preflight counts, and exact single-row statement. One person checking a manual
command twice is not equivalent. This repository does not currently include
such a tool; a solo maintainer must obtain a second reviewer or stop and add the
guarded tooling first.

Before handling a request, confirm all of the following:

- the support mailbox is access controlled and can send a new message to the
  stored address;
- the exact Worker, Cloudflare account, D1 database name, and D1 database ID are
  known and match the intended host application;
- an approved D1 client can bind SQL parameters without placing values in SQL
  text, shell history, process arguments, or logs;
- the Cloudflare plan and resulting D1 Time Travel window are known;
- every manual export and longer-lived backup is inventoried with an owner and
  destruction date;
- an access-restricted deletion receipt store outside the primary D1 exists so
  a later restore can reapply deletions before traffic resumes; and
- the legal owner has decided the support-message, receipt, export, and
  reconciliation retention periods.

Do not create an ad hoc full D1 export for an ordinary deletion. Time Travel is
already the disaster-recovery layer, and a new export would create another copy
of the data being deleted.

## 1. Verify the request without collecting more profile data

1. Require the request to come from the Google mailbox used for the old login.
2. Send a new message to that address containing a cryptographically random,
   single-use challenge with at least 128 bits of entropy and the case ID. Do
   not rely only on the inbound `From` header.
3. Require a reply containing the challenge and an explicit confirmation that
   the requester wants the entire server account and all synced data deleted.
   Expire the challenge after the approved short window (never more than 24
   hours) and after one use.
4. Explain before confirmation that local data on the requester's devices is
   separate, Google grant removal has a separate outcome, and D1 recovery data
   can remain for the stated recovery window.

Never request a password, OAuth authorization code, access token, ID token,
cookie, birth date or time, real name, identity-document image, profile image,
saved reading, screenshot, or device export. If the requester no longer controls
the stored mailbox, stop. Use a separately approved legal escalation path; do
not invent knowledge-based questions from profile or synced data.

The challenge remains only in the restricted mailbox while the case is open.
The durable receipt records the verification method and result, not the email or
challenge value.

## 2. Map the verified address to exactly one account

Use an approved parameter-capable D1 client against the live database. Never
interpolate the email into `wrangler d1 execute --command`, a SQL file, or a
dashboard query. The current Worker API cannot perform this lookup.

The operator tool may use this read-only query shape, with the verified address
bound as parameter `?1`:

```sql
WITH candidates AS (
  SELECT id, emailVerified, createdAt
  FROM user
  WHERE lower(email) = lower(?1)
)
SELECT
  candidates.id AS user_id,
  candidates.emailVerified AS email_verified,
  candidates.createdAt AS user_created_at,
  COUNT(account.id) AS linked_account_count,
  SUM(CASE WHEN account.providerId = 'google' THEN 1 ELSE 0 END) AS google_account_count
FROM candidates
LEFT JOIN account ON account.userId = candidates.id
GROUP BY candidates.id, candidates.emailVerified, candidates.createdAt
ORDER BY candidates.id
LIMIT 3;
```

Do not remove dots, strip `+suffix` values, perform a partial match, search by
display name, or substitute another address. Case-insensitive comparison is
allowed only because the query still stops on multiple candidates.

Continue only when the query returns exactly one user, `email_verified = 1`,
and exactly one Google account. For the former Byulsata internal-test scope,
unexpected additional providers are a stop condition. In the secure client,
read that user's Google `accountId` with the selected `user.id` bound as `?1`:

```sql
SELECT accountId
FROM account
WHERE userId = ?1
  AND providerId = 'google'
ORDER BY accountId
LIMIT 2;
```

Require exactly one row. Do not copy the raw `user.id`, email, or `accountId`
into the case receipt.

Compute a target fingerprint in the controlled tool:

```text
HMAC-SHA-256(audit-key, canonical-JSON([deployment-id, "google", google-account-id]))
```

The HMAC key must be outside the repository, D1, and receipt store. Plain SHA-256
is not a substitute. The canonical encoder and fingerprint version must be fixed
before the first case so restore-time matching produces the same bytes. Show the
raw identifiers only transiently to the verifier and approver; persist only the
keyed fingerprint.

If the user was created after the deletion request, or the original account may
already have been deleted and recreated, treat it as a new account. Obtain a new
confirmation instead of treating it as a retry.

## 3. Provider revocation classification

If the requester can still use the legacy authenticated flow, let them use the
self-service endpoint; never ask them to send a session cookie. For the manual
D1 path, ask the requester to review the app in [Google Account third-party
connections](https://support.google.com/accounts/answer/13533235) and remove its
access before the D1 write. A screenshot is neither required nor accepted.

Record one of these outcomes:

- `confirmed-provider-side` — the requester confirms that the connection is no
  longer present after using Google's connection management;
- `unconfirmed` — the requester cannot verify removal, the automatic attempt is
  the only evidence, or the provider was unavailable.

Do not infer `confirmed-provider-side` from the Worker's `204`, from the absence
of a sampled warning log, or from any Google revoke response other than the
documented HTTP `200`. In particular, HTTP `400` is not revocation evidence.
Provider uncertainty does not block deletion of data controlled in D1. If the
outcome is `unconfirmed`, disclose it and provide Google's manual removal link.
After the D1 cascade, the stored provider token is gone and the operator must not
claim that a later automatic retry remains possible.

## 4. Read-only dry run and independent approval

Bind the selected `user.id` as `?1` and return counts only. Do not select payload,
token, cookie, email, name, image, IP address, user agent, or reading fields.

```sql
WITH target(user_id) AS (VALUES (?1))
SELECT
  (SELECT COUNT(*) FROM user WHERE id = (SELECT user_id FROM target)) AS user_rows,
  (SELECT COUNT(*) FROM session WHERE userId = (SELECT user_id FROM target)) AS session_rows,
  (SELECT COUNT(*) FROM account WHERE userId = (SELECT user_id FROM target)) AS account_rows,
  (SELECT COUNT(*) FROM sync_records WHERE user_id = (SELECT user_id FROM target)) AS record_rows,
  (SELECT COUNT(*) FROM sync_mutations WHERE user_id = (SELECT user_id FROM target)) AS mutation_rows,
  (SELECT COUNT(*) FROM sync_changes WHERE user_id = (SELECT user_id FROM target)) AS change_rows;
```

The verifier creates a keyed HMAC approval digest over the database ID, target
fingerprint, account-link count, these six counts, query version
`legacy-account-delete/v1`, and a short expiry time. The approver independently
checks:

- the database identity, not merely its binding or display name;
- `user_rows = 1`;
- the provider tuple and linked-account count are unchanged;
- every nonzero child count is expected for this one user;
- the confirmation and challenge are current; and
- the write below is parameterized and contains every guard.

Any count or mapping change invalidates approval. Repeat the read-only review;
do not edit the approved values in place.

## 5. Execute one guarded live cascade

Use the approved parameter-capable client. Bind the exact `user.id` as `?1`, the
exact Google `accountId` as `?2`, the approved linked-account count as `?3`, the
approved `user.createdAt` value as `?4`, and the approved session, record,
mutation, and change counts as `?5` through `?8`. Execute this single statement
and require exactly one returned row:

```sql
DELETE FROM user
WHERE id = ?1
  AND createdAt = ?4
  AND EXISTS (
    SELECT 1
    FROM account
    WHERE account.userId = user.id
      AND account.providerId = 'google'
      AND account.accountId = ?2
  )
  AND (
    SELECT COUNT(*)
    FROM account
    WHERE account.userId = user.id
  ) = ?3
  AND (
    SELECT COUNT(*)
    FROM session
    WHERE session.userId = user.id
  ) = ?5
  AND (
    SELECT COUNT(*)
    FROM sync_records
    WHERE sync_records.user_id = user.id
  ) = ?6
  AND (
    SELECT COUNT(*)
    FROM sync_mutations
    WHERE sync_mutations.user_id = user.id
  ) = ?7
  AND (
    SELECT COUNT(*)
    FROM sync_changes
    WHERE sync_changes.user_id = user.id
  ) = ?8
RETURNING id;
```

The client must not log the returned ID. D1 keeps `ON DELETE CASCADE` active, so
the one user deletion removes the linked auth and sync rows. Never replace this
statement with `DELETE FROM user` without the exact ID and provider guards,
`DELETE ... WHERE email LIKE ...`, a table drop, a database delete, or a script
that loops over candidates.

Immediately repeat the count query with the same bound user ID. All six counts
must be zero. Then repeat the parameter-bound email candidate lookup; it must not
find the deleted account. Keep only the counts and target fingerprint in the
receipt.

## 6. Lost responses, retries, and ambiguous `204`

The desired state is idempotent, but the current HTTP API has no deletion
operation receipt. A lost `204` followed by `401` can mean the account was
successfully deleted and its session disappeared. It is not proof of failure.

- Do not sign in again merely to test deletion; a new sign-in may create a new
  account.
- Repeat only the read-only, parameter-bound mapping and six-count check.
- If the original target has zero rows, record live D1 deletion as
  `completed-after-state-verification`. Keep provider revocation `unconfirmed`
  unless provider-side evidence exists.
- If the exact original target and mapping remain unchanged, obtain a fresh
  approval digest before retrying the same guarded statement.
- If a new user, different provider subject, changed linked-account count, or
  partial/orphaned state appears, stop. Do not delete it as a retry.

The same rule applies if the D1 client's response is lost. Post-state, not a
transport response, determines the live D1 result.

## 7. Recovery copies, exports, and restore safety

Live deletion does not erase D1 Time Travel history immediately. Cloudflare
states that Time Travel is always on and retains point-in-time recovery for 7
days on Workers Free and 30 days on Workers Paid. Confirm the actual plan at the
time of deletion and calculate the no-later-than recovery expiry in UTC. See
[Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
and [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Manual exports are separate copies and can outlive Time Travel. Inventory every
export; record its destruction date or the documented legal exception. D1 export
files contain sensitive production data and must never be attached to the case
or committed to source control. See [D1 import and
export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Keep the keyed target fingerprint outside D1 for at least the longest applicable
Time Travel or export restoration window. Before any restore:

1. keep the Worker unavailable to users;
2. restore only under the separate disaster-recovery change procedure;
3. use the controlled tool to HMAC provider identities in the restored database
   and match every unexpired deletion fingerprint;
4. reapply each exact guarded cascade and verify zero counts;
5. invalidate restored sessions; and
6. do not resume sync until the host's cursor/epoch reset procedure has been
   exercised against a disposable database.

The current service has no automated deletion-reconciliation ledger and no sync
epoch/reset protocol. Therefore a production Time Travel or export restore must
stop before traffic resumes until those controls are supplied and verified.
Never restore the whole live database just to recover one deleted account.

## 8. Privacy-safe receipt

Store a restricted, append-only receipt outside the primary D1. It may contain:

- random case ID;
- request, confirmation, execution, and recovery-expiry timestamps in UTC;
- deployment and D1 database identifiers;
- verifier, approver, and executor identities;
- verification method/status, without the address or challenge;
- keyed target fingerprint and approval digest;
- preflight and postflight counts only;
- statement/query version and exactly-one-row assertion;
- `liveD1Deletion: completed | completed-after-state-verification`;
- `providerRevocation: confirmed-provider-side | unconfirmed`;
- Time Travel plan/window and no-later-than expiry;
- export inventory result and each applicable expiry or legal exception; and
- response-sent timestamp.

Do not store raw email, `user.id`, `accountId`, access/refresh/ID tokens, session
tokens, cookies, authorization headers, IP addresses, user agents, names, images,
birth/profile values, synced payloads, SQL result dumps, or screenshots in the
receipt. A keyed fingerprint remains restricted operational metadata; delete it
after every possible restore source has expired or been destroyed and the
approved receipt-retention period ends.

## 9. Response template (Korean)

Replace brackets only with verified, non-sensitive case and timing values.

```text
제목: [별사타로] 서버 계정 삭제 처리 결과 — [CASE-ID]

요청하신 별사타로 서버 계정과 계정에 연결된 로그인 세션·연결 정보·동기화
데이터를 [YYYY-MM-DD HH:MM UTC]에 실시간 서비스 데이터에서 삭제했습니다.
기기에 저장된 정보는 이번 처리에 포함되지 않습니다.

Google 연결 해지 상태: [Google 계정에서 해지 확인 / 자동 해지 여부 미확인]
[미확인인 경우: Google 계정의 서드 파티 연결 관리에서 별사타로 연결을 직접
확인하고 제거해 주세요: https://support.google.com/accounts/answer/13533235]

Cloudflare 장애 복구 이력에는 [7일/30일] 범위로 과거 상태가 남을 수 있으며,
이번 삭제 데이터의 복구 가능 기간은 늦어도 [YYYY-MM-DD HH:MM UTC]까지입니다.
[별도 export가 있는 경우: 제한된 별도 백업은 [만료일/법적 보존 예외]까지
접근 제한 상태로 남습니다.] 장애 복구를 수행하면 완료된 삭제 요청을 다시
적용한 뒤에만 서비스를 재개합니다.

처리 번호: [CASE-ID]
문의: [공개 지원 이메일]
```

Do not send an exact recovery-expiry claim until the current plan and all exports
have been inventoried. If either is unknown, pause the completion response and
escalate rather than substituting an estimate.

## Stop conditions

Stop without making a write when any of these is true:

- the database account, name, ID, environment, or host application is uncertain;
- the requester does not complete the challenge from the stored mailbox;
- lookup returns zero or multiple users, an unverified/placeholder address, zero
  or multiple Google identities, or an unexpected provider;
- a raw identifier would have to be interpolated into SQL or exposed in logs;
- a second-person approval or enforced equivalent is unavailable;
- the mapping or counts changed after approval;
- the target may be a newly recreated account;
- the guarded statement does not return exactly one row and the post-state is
  not conclusively zero;
- child rows remain after the cascade;
- an export inventory, recovery window, receipt store, or restore
  reconciliation path is unavailable;
- a legal hold or conflicting statutory instruction applies; or
- anyone proposes a broad delete, production restore, user impersonation, token
  collection, or schema change as an improvised shortcut.

Provider revocation being `unconfirmed` is not a reason to retain the live D1
account. It is a reason to disclose the separate outcome accurately and direct
the requester to Google connection management.

## Source anchors and change control

This procedure is tied to the current implementation in
[`account.ts`](../apps/worker/src/account.ts),
[`app.ts`](../apps/worker/src/app.ts), and migrations
[`0001_auth.sql`](../apps/worker/migrations/0001_auth.sql),
[`0002_sync.sql`](../apps/worker/migrations/0002_sync.sql), and
[`0003_account_identity.sql`](../apps/worker/migrations/0003_account_identity.sql).
Re-review the query shapes, cascade scope, response semantics, and receipt fields
after any auth, schema, provider-revocation, account-linking, deletion, backup,
or restore change. A newer migration or endpoint behavior takes precedence over
this document; until the runbook is updated and independently reviewed, stop the
manual operation.
