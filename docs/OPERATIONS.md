# Operations guide

Reviewed: 2026-08-13

This is a CLI-first self-hosted starter. The owner Worker and production D1
database were deployed on 2026-07-21 at
`https://cloudflare-mobile-sync.ponntailstudio.workers.dev`. All committed
migrations are applied. Google credentials and its Worker callback are
configured; the real mobile login flow still requires an Expo development-build
verification.

This maintainer deployment is not a public sandbox. A third-party adopter must
follow [the self-hosting guide](./SELF_HOSTING.md) and replace every
account-specific Wrangler value before running a remote command.

## Local development

1. Install Node.js 22.13–24, Corepack, and pnpm 11.9.0.
2. Run `pnpm install` at the repository root.
3. Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` and replace placeholders. The file is ignored by Git.
4. Apply the committed migrations with `pnpm --filter @cloudflare-mobile-sync/worker migrate:local`.
5. Start the API with `pnpm --filter @cloudflare-mobile-sync/worker dev`.
6. Copy `examples/expo-app/.env.example` to `.env.local`, choose a reachable Worker URL, and start an Expo development build with `pnpm --filter @cloudflare-mobile-sync/expo-app dev`.

`127.0.0.1` works for the web preview and normally for the iOS simulator. Android Emulator commonly reaches the host through `10.0.2.2`. A physical device needs a LAN or HTTPS development URL reachable from that device. Stable mobile OAuth callbacks require a development build; do not use Expo Go for the provider verification gate.

## Choose the host app identity

The identifiers in `examples/expo-app/app.json` are starter placeholders. Before
building a real host app, choose three stable values and keep them in that host
app rather than turning this repository into a product-specific SDK:

| Expo setting | Recommended form | Example |
| --- | --- | --- |
| `scheme` | reverse-domain name controlled by the publisher | `com.acme.myapp` |
| `ios.bundleIdentifier` | unique reverse-DNS identifier | `com.acme.myapp` |
| `android.package` | unique reverse-DNS identifier; lowercase segments | `com.acme.myapp` |

Use a publisher namespace that you control. The iOS and Android identifiers may
match for simplicity, but they are separate store identities. Treat all three as
permanent once store builds or OAuth callbacks depend on them.

After changing the scheme:

1. Put `<scheme>://` in the Worker's exact `TRUSTED_ORIGINS` list.
2. Keep provider callbacks pointed at the Worker HTTPS URL; providers do not
   callback directly to the custom mobile scheme.
3. Create a new development build. Expo Go does not provide a stable OAuth
   callback URL for this flow.

The generic example can retain its existing placeholder identity unless it will
itself be distributed through an app store.

## Create an isolated Cloudflare deployment

Choose one stable public Worker origin before registering provider callbacks.
If a domain already exists in a Cloudflare zone, a dedicated Custom Domain such
as `sync.example.com` is the recommended production origin. Otherwise, use the
assigned `workers.dev` origin for the first end-to-end verification and avoid
changing it after provider rollout unless all callback registrations are updated.

From the repository root:

```bash
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler login
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler d1 create cloudflare-mobile-sync-prod
```

For this owner account, that resource already exists and its returned ID is
committed in `apps/worker/wrangler.jsonc`. The account had no other Workers when
rate-limit `namespace_id` values `1001` and `1003` were selected. A different
adopter must create a separate D1 database, replace the committed ID, and verify
that both namespace IDs are unique in their account.

Use an environment-specific database name such as
`cloudflare-mobile-sync-prod`. Keep the binding name `DB`; portable Worker code
depends on the binding interface, not the Cloudflare database ID. For a Custom
Domain, add the following top-level configuration with the real hostname:

```jsonc
"routes": [
  { "pattern": "sync.example.com", "custom_domain": true }
]
```

The minimum production values then become:

```text
BETTER_AUTH_URL=https://your-worker.your-subdomain.workers.dev
TRUSTED_ORIGINS=com.acme.myapp://
ALLOWED_COLLECTIONS=notes
EXPO_PUBLIC_MOBILE_SYNC_URL=https://your-worker.your-subdomain.workers.dev
EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS=
```

Change the last value to `google` only after its Worker credentials and provider
callback have been configured and verified.

`BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, and `ALLOWED_COLLECTIONS` are non-secret
Worker configuration. Provider credentials and Better Auth keys are Worker
secrets. Never put a provider secret in an `EXPO_PUBLIC_*` value.

Generate high-entropy secrets outside the repository. Copy
`apps/worker/.env.production.example` to the ignored `.env.production` file. For
a new installation, use the same initial value for `BETTER_AUTH_SECRET` and
version 1 of `BETTER_AUTH_SECRETS`; the latter makes new encrypted values
rotation-aware. The committed primary and ANT HELL configurations also require
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; add their real values only after
registering the exact callback. Kakao and Naver remain optional until their
deployments intentionally enable them.

```powershell
cd apps/worker
Copy-Item .env.production.example .env.production
```

On macOS or Linux, use `cp` instead of `Copy-Item`. Keep the file only on the
trusted deployment machine. Before any remote mutation, run `pnpm
test:preflight`. For an existing deployment also run the matching read-only
remote name check (`pnpm preflight:worker` or `pnpm preflight:ant-hell`). A first
deployment has no remote secret names yet; in that case run
the preflight with `--secrets-source environment` in the process that holds the
pending secret names. Then apply migrations before deploying code that needs
them, and upload the initial secrets atomically with the Worker code:

```bash
node --env-file=apps/worker/.env.production scripts/preflight-worker-config.mjs --config apps/worker/wrangler.jsonc --secrets-source environment
pnpm --filter @cloudflare-mobile-sync/worker migrate:remote
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler deploy --secrets-file .env.production
```

The first command changes the remote database and the second publishes the
Worker. Review both commands before running them. Subsequent secret changes can
use Wrangler's versioned secret commands or another atomic deployment; plain
`wrangler secret put` immediately creates and deploys a Worker version.

Verify `/health`, an unauthenticated rejection, provider callbacks, a two-user isolation test, mutation replay, account deletion, and provider-console unlink state after deployment.

`/health` intentionally reports D1 readiness and the public protocol version,
not a source revision or configuration fingerprint. The current manual release
flow does not inject an immutable source revision that can be proven to match a
specific built artifact; returning the package version, selected non-secret
configuration, or a locally computed dirty-worktree hash would therefore look
more authoritative than it is. Add deployment-version metadata only together
with a reproducible release pipeline that binds an immutable revision to the
uploaded Worker version. No secret or origin/collection policy belongs in the
health response.

Worker-owned provider profile and revocation requests time out after 10 seconds.
The Expo sync transport defaults to 15 seconds per attempt and supports a
smaller `requestTimeoutMilliseconds` value for host-specific needs.

Persisted Worker logs are enabled, while automatic invocation logs are disabled
to keep the default signal small. Unexpected failures include only a request ID,
method, path without query parameters, and error class. Provider-revocation
warnings include provider names only. Match a client-visible `X-Request-ID` in
the Cloudflare Workers Logs dashboard or with `wrangler tail`; never add request
bodies, cookies, authorization headers, OAuth query strings, or raw errors to
these records.

## Migrations and rollback

- Every schema change is a new numbered SQL migration. Never edit a migration already applied remotely.
- Test migrations against disposable local state before remote application.
- Before applying migration `0003_account_identity.sql` to an existing database,
  run the following read-only query. Any result needs an owner-reviewed account
  recovery decision; do not delete a duplicate automatically:

  ```sql
  SELECT providerId, accountId, COUNT(*) AS copies
  FROM account
  GROUP BY providerId, accountId
  HAVING COUNT(*) > 1;
  ```

- Export a backup before a consequential migration with Wrangler's remote D1 export command and store it outside the repository.
- D1 migrations are forward-only. Rolling back Worker code is safe only when the older code is compatible with the migrated schema; otherwise write a forward repair migration and test it locally.
- Never commit an export because it may contain sessions, encrypted provider tokens, profiles, and host-app data.

## Secret rotation

`BETTER_AUTH_SECRETS` is a comma-separated keyring in newest-first `version:secret` form, for example `2:<new>,1:<old>`. Better Auth encrypts new values with the first entry and can decrypt versioned values with retained older entries. `BETTER_AUTH_SECRET` remains the fallback for pre-keyring values.

Do not remove an older decryption key merely because sessions have expired. Provider tokens may remain encrypted with that version until refreshed or relinked. This starter intentionally has no bulk token re-encryption job. Removing an old key therefore requires an explicit inventory and migration plan; after a suspected compromise, revoke sessions and provider grants and require relinking as appropriate.

Rotate provider client secrets in each provider console, update the corresponding Worker secret, deploy, and verify both a new login and an existing account's unlink/delete behavior.

## Backup, restore, and deletion checks

- Treat D1 exports as sensitive production data and encrypt/restrict them at rest.
- Test restore procedures into a separate disposable D1 database, never over the live binding first.
- After remote account deletion, confirm the user, session, account, mutation, record, and change rows are absent and confirm provider-console unlink state.
- Local app data is host-owned and remains by default. If a host app offers local erase, it must be a separate explicit destructive action.
- For an email request from a former internal-test user who cannot reach the
  self-service flow, follow the
  [legacy account-deletion operator runbook](./LEGACY_ACCOUNT_DELETION.md). It
  requires mailbox verification, exact parameter-bound lookup, independent
  approval, a one-user guarded cascade, provider-status disclosure, and
  restore-time deletion reconciliation. There is no admin email-lookup API.

## Troubleshooting

- OAuth returns to the wrong path: confirm `BETTER_AUTH_URL` contains only the public origin and provider callbacks include `/v1/auth`.
- OAuth opens Expo Go: install and select the development build with the configured app scheme.
- Android cannot reach local Worker: replace `127.0.0.1` with `10.0.2.2` for Android Emulator or a reachable LAN address for a device.
- `401` after restart: treat the server session as authoritative, sign out locally, and authenticate again.
- Push conflict: inspect the per-mutation `current` record and explicitly keep local data at its revision or adopt the server record.
- D1 migration mismatch: inspect local migration state, recreate disposable local state if necessary, and never mark a remote migration applied manually without verifying its SQL effects.
- A Cloudflare `1042` immediately after a first deployment can be a transient
  routing-propagation response. Retry `/health` and inspect `wrangler tail`; if it
  persists, investigate same-zone Worker subrequests rather than adding a
  compatibility flag without evidence.
