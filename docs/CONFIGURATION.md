# Configuration contract

Reviewed: 2026-08-13

Configuration is split by trust boundary. The portable packages accept options
and never read environment variables themselves.

## Worker repository

Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` for local
development. It contains the complete local Worker runtime configuration except
for the D1 and rate-limit bindings supplied by Wrangler. The real file is ignored
by Git.

| Name | Kind | Where it belongs |
| --- | --- | --- |
| `ALLOWED_COLLECTIONS` | non-secret | Wrangler `vars`; `.dev.vars` locally |
| `BETTER_AUTH_URL` | non-secret | Wrangler `vars`; `.dev.vars` locally |
| `TRUSTED_ORIGINS` | non-secret | Wrangler `vars`; `.dev.vars` locally |
| `BETTER_AUTH_SECRET` | secret | Worker secret; `.dev.vars` locally |
| `BETTER_AUTH_SECRETS` | secret | Worker secret; `.dev.vars` locally |
| `*_CLIENT_ID` | server configuration | Worker secret; `.dev.vars` locally |
| `*_CLIENT_SECRET` | secret | Worker secret; `.dev.vars` locally |
| `CLOUDFLARE_API_TOKEN` | deployment credential | CI secret only; not a Worker binding |
| `CLOUDFLARE_ACCOUNT_ID` | deployment configuration | CI secret/variable only |

For an interactive developer machine, prefer `wrangler login` over storing a
Cloudflare token in a file. For CI, use a narrowly scoped API token stored in the
CI provider's secret store. Never add either Cloudflare value to a mobile app.

Production non-secret values and Cloudflare resource bindings remain explicit in
`apps/worker/wrangler.jsonc`. Copy `apps/worker/.env.production.example` to the
ignored `apps/worker/.env.production` file for the first deployment. Wrangler
uploads those values as encrypted Worker secrets when the file is passed with
`--secrets-file`; the real file must never be committed.

The maintainer reference instance uses:

```text
Worker origin: https://cloudflare-mobile-sync.ponntailstudio.workers.dev
D1 database: cloudflare-mobile-sync-prod
D1 binding: DB
```

Its production trusted-origin allowlist contains only the three Byulsata build
schemes (`com.byeolsata.app.dev://`, `com.byeolsata.app.preview://`, and
`com.byeolsata.app://`). All mobile schemes must use reverse-domain notation.
Its application-data allowlist contains only `saved-readings-v1` and
`app-settings-v1`, the two collections explicitly synchronized by Byulsata.
The generic local example uses
`com.example.cloudflaremobilesync://` and is not authorized against the
maintainer Worker.

The D1 ID and public Worker origin are deployment configuration, not credentials.
`BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS`, and provider credentials remain
secret. `apps/worker/required-secrets.json` is the repository's single source of
truth for the secret binding names each committed deployment requires. Do not
duplicate that list in a Wrangler `secrets` block: a stale schema path or a
Wrangler version that does not enforce the field can otherwise create false
assurance.

The committed primary Worker and ANT HELL Worker each require four names:
`BETTER_AUTH_SECRET`, `BETTER_AUTH_SECRETS`, `GOOGLE_CLIENT_ID`, and
`GOOGLE_CLIENT_SECRET`. The primary entry includes Google because that reference
deployment exposes the verified Google vertical slice; a missing provider secret
must fail before a deployment rather than silently remove its login method.
Kakao and Naver remain optional and are not listed until their corresponding
deployment intentionally enables them.

`pnpm test:preflight` validates both committed Wrangler files against the JSON
Schema shipped with the pinned local Wrangler, checks the secret-name manifest,
and verifies fail-closed origin and collection policies. It uses fixtures and
does not require Cloudflare credentials. Immediately before an existing remote
deployment, use the read-only name check for the selected Worker:

```bash
pnpm preflight:worker
pnpm preflight:ant-hell
```

These commands call `wrangler secret list --format json` and compare names only;
secret values are neither available from Wrangler nor printed by the preflight.
For a first deployment whose remote secrets do not exist yet, run the CLI with
`--secrets-source environment` in a process that already has the required names
set. The environment preflight also rejects the committed example placeholder
values without printing them. It does not replace provider-side credential
validation; then upload the same reviewed values atomically with `--secrets-file`:

```bash
node --env-file=apps/worker/.env.production scripts/preflight-worker-config.mjs --config apps/worker/wrangler.jsonc --secrets-source environment
```

These reference values are not public defaults. Every adopter must replace the
Worker name, D1 name and ID, public origin, trusted app origins, allowed
collections, and rate-limit namespace before any remote operation. Follow
[the self-hosting guide](./SELF_HOSTING.md).

## Consuming Expo app

Copy `docs/consumer-app.env.example` to the consuming app as `.env.local`:

```dotenv
EXPO_PUBLIC_MOBILE_SYNC_URL=https://sync.example.com
EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS=google
```

- `EXPO_PUBLIC_MOBILE_SYNC_URL` is the public HTTPS Worker origin without a
  trailing slash.
- `EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS` is a comma-separated subset of
  `google,kakao,naver`. It controls only which login choices the app exposes; the
  Worker remains authoritative about configured providers.
- Every `EXPO_PUBLIC_*` value is bundled in plain text. Do not place credentials,
  signing keys, tokens, D1 IDs, private user data, or provider secrets in it.

The app scheme, iOS bundle identifier, and Android package are build identities,
not secrets or runtime environment variables. Keep them in the consuming app's
Expo app configuration and pass the compiled scheme to `createExpoAuthClient`.

## Domain discovery

Wrangler can identify the active Cloudflare account after login:

```bash
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler login
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler whoami
```

Wrangler does not provide a general zone-list command. To inspect managed
domains, open the Cloudflare dashboard and select **Websites** from the account
home. Every active zone listed there is a domain managed by that account. A
Worker Custom Domain must be a hostname under one of those zones.

As of 2026-07-20, the authenticated owner account has no managed zones. Its
account subdomain is `ponntailstudio.workers.dev`, so the prepared Worker origin
is `https://cloudflare-mobile-sync.ponntailstudio.workers.dev`. A future custom
domain can replace this after a zone is added and all OAuth callbacks and
consumer URLs are updated together.
