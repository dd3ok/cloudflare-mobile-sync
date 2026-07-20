# Operations guide

Reviewed: 2026-07-20

This is a CLI-first self-hosted starter. The commands below describe owner actions; they have not been run against production resources by this repository.

## Local development

1. Install Node.js 22.13–24, Corepack, and pnpm 11.9.0.
2. Run `pnpm install` at the repository root.
3. Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` and replace placeholders. The file is ignored by Git.
4. Apply the committed migrations with `pnpm --filter @cloudflare-mobile-sync/worker migrate:local`.
5. Start the API with `pnpm --filter @cloudflare-mobile-sync/worker dev`.
6. Copy `examples/expo-app/.env.example` to `.env`, choose a reachable Worker URL, and start an Expo development build with `pnpm --filter @cloudflare-mobile-sync/expo-app dev`.

`127.0.0.1` works for the web preview and normally for the iOS simulator. Android Emulator commonly reaches the host through `10.0.2.2`. A physical device needs a LAN or HTTPS development URL reachable from that device. Stable mobile OAuth callbacks require a development build; do not use Expo Go for the provider verification gate.

## Choose the host app identity

The identifiers in `examples/expo-app/app.json` are starter placeholders. Before
building a real host app, choose three stable values and keep them in that host
app rather than turning this repository into a product-specific SDK:

| Expo setting | Recommended form | Example |
| --- | --- | --- |
| `scheme` | short lowercase app name | `my-app` |
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
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler d1 create cloudflare-mobile-sync
```

Replace the placeholder `database_id` in `apps/worker/wrangler.jsonc` with the returned ID. Also choose a rate-limit `namespace_id` unique within the Cloudflare account, set the production `BETTER_AUTH_URL`, exact `TRUSTED_ORIGINS`, and the deployment's collection allowlist.

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
BETTER_AUTH_URL=https://sync.example.com
TRUSTED_ORIGINS=my-app://
ALLOWED_COLLECTIONS=notes
EXPO_PUBLIC_SYNC_URL=https://sync.example.com
```

`BETTER_AUTH_URL`, `TRUSTED_ORIGINS`, and `ALLOWED_COLLECTIONS` are non-secret
Worker configuration. Provider credentials and Better Auth keys are Worker
secrets. Never put a provider secret in an `EXPO_PUBLIC_*` value.

Generate high-entropy secrets outside the repository. For a new installation, use the same initial value for `BETTER_AUTH_SECRET` and version 1 of `BETTER_AUTH_SECRETS`; the latter makes new encrypted values rotation-aware:

```bash
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler secret put BETTER_AUTH_SECRET
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler secret put BETTER_AUTH_SECRETS
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler secret put GOOGLE_CLIENT_ID
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler secret put GOOGLE_CLIENT_SECRET
```

Add only the Kakao or Naver secrets for providers being enabled. Then apply migrations before deploying code that needs them:

```bash
pnpm --filter @cloudflare-mobile-sync/worker migrate:remote
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler deploy
```

Verify `/health`, an unauthenticated rejection, provider callbacks, a two-user isolation test, mutation replay, account deletion, and provider-console unlink state after deployment.

## Migrations and rollback

- Every schema change is a new numbered SQL migration. Never edit a migration already applied remotely.
- Test migrations against disposable local state before remote application.
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

## Troubleshooting

- OAuth returns to the wrong path: confirm `BETTER_AUTH_URL` contains only the public origin and provider callbacks include `/v1/auth`.
- OAuth opens Expo Go: install and select the development build with the configured app scheme.
- Android cannot reach local Worker: replace `127.0.0.1` with `10.0.2.2` for Android Emulator or a reachable LAN address for a device.
- `401` after restart: treat the server session as authoritative, sign out locally, and authenticate again.
- Push conflict: inspect the per-mutation `current` record and explicitly keep local data at its revision or adopt the server record.
- D1 migration mismatch: inspect local migration state, recreate disposable local state if necessary, and never mark a remote migration applied manually without verifying its SQL effects.
