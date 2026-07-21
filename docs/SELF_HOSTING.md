# Self-hosting guide

Reviewed: 2026-07-21

Cloudflare Mobile Sync is distributed as source code, not as a shared hosted
service. Every adopter deploys one Worker and one D1 database to an account they
control and creates their own OAuth applications. Do not point a consumer app at
the maintainer's reference Worker.

The first public source release is CLI-first. One-click deployment and public
npm packages are intentionally deferred until the first real host app completes
provider and device verification.

## 1. Prerequisites

- Node.js 22.13 through 24 and Corepack
- pnpm 11.9.0
- a Cloudflare account with Workers and D1 access
- an Expo SDK 57 development build for native OAuth verification
- a provider developer account for every provider you enable

Fork or clone the repository, then install and verify it before changing remote
resources:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm security:audit
```

## 2. Replace the reference deployment values

The committed `apps/worker/wrangler.jsonc` describes the maintainer's reference
deployment. Before running any command with `--remote` or `wrangler deploy`,
replace all account-specific values in your fork:

- `name`: a unique Worker name
- `database_name` and `database_id`: your D1 database
- `ratelimits[].namespace_id`: an unused integer namespace in your account
- `BETTER_AUTH_URL`: your stable public Worker origin
- `TRUSTED_ORIGINS`: the exact schemes or HTTPS origins of your apps
- `ALLOWED_COLLECTIONS`: only the logical collections your app intentionally
  uploads

Use a dedicated Worker and D1 database for each unrelated application. Sharing
one deployment also shares user accounts, rate limits, account-deletion scope,
and the application-data namespace.

Sign in to Cloudflare and create the database:

```bash
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler login
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler whoami
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler d1 create <your-database-name>
```

Paste the returned database name and ID into `wrangler.jsonc`. Choose either the
assigned `https://<worker>.<account-subdomain>.workers.dev` origin or a stable
Custom Domain. Set `BETTER_AUTH_URL` to that origin without `/v1/auth` or a
trailing slash.

For a native app with scheme `my-app`, use the exact production origin:

```jsonc
"TRUSTED_ORIGINS": "my-app://"
```

Multiple explicitly supported apps or build variants use a comma-separated
list. Do not use production wildcards merely to avoid listing schemes.

## 3. Configure local development

Copy the example and replace its placeholders locally:

```powershell
Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars
```

On macOS or Linux, use `cp`. Keep `.dev.vars` ignored. Apply migrations and run
the Worker with local D1 state:

```bash
pnpm --filter @cloudflare-mobile-sync/worker migrate:local
pnpm --filter @cloudflare-mobile-sync/worker dev
```

Local D1 is separate from production. Never use remote bindings merely to make
local setup faster.

## 4. Create production secrets

Copy `apps/worker/.env.production.example` to the ignored
`apps/worker/.env.production` file. Generate a fresh high-entropy value on the
trusted deployment machine:

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(48).toString('base64url'))"
```

For a new installation, put that value in `BETTER_AUTH_SECRET` and use the same
initial value as version 1 in `BETTER_AUTH_SECRETS`:

```dotenv
BETTER_AUTH_SECRET=<generated-value>
BETTER_AUTH_SECRETS=1:<generated-value>
```

Provider client IDs and secrets belong in this Worker-only file. Never place a
provider secret, Better Auth secret, Cloudflare credential, session token, or D1
ID in an `EXPO_PUBLIC_*` value.

## 5. Register OAuth callbacks

Create provider applications under your own organization or developer account.
For Worker origin `https://sync.example.com`, register the exact callbacks:

| Provider | Callback |
| --- | --- |
| Google | `https://sync.example.com/v1/auth/callback/google` |
| Kakao | `https://sync.example.com/v1/auth/oauth2/callback/kakao` |
| Naver | `https://sync.example.com/v1/auth/oauth2/callback/naver` |

Google uses a Web application OAuth client because the confidential code
exchange occurs in the Worker. Enable only providers for which both required
Worker credentials and the callback are configured. See
[the provider guide](./PROVIDERS.md) for scopes, provider-specific setup, and
verification requirements.

## 6. Migrate and deploy

Run the remote migration explicitly before publishing code that depends on it:

```bash
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler d1 migrations apply DB --remote
pnpm --filter @cloudflare-mobile-sync/worker exec wrangler deploy --secrets-file .env.production
```

Wrangler resolves `DB` through the binding in your edited configuration. The
secrets file is uploaded as encrypted Worker secrets and must remain outside
Git.

Verify the public boundary before connecting an app:

```bash
curl https://your-worker.your-subdomain.workers.dev/health
curl https://your-worker.your-subdomain.workers.dev/v1/auth/get-session
curl https://your-worker.your-subdomain.workers.dev/v1/account
```

Expected results are `200` with `{ "ok": true, ... }`, `200` with `null` before
login, and `401` for the protected account endpoint before login.

## 7. Connect a consumer app

The public source release does not publish SDK packages to npm. An Expo app kept
inside the forked workspace can depend on the three internal packages with
`workspace:*`; an app in a separate repository can use the documented HTTPS API
until versioned package distribution is added. Do not copy only `expo-client`
without its portable `client-core` and `api-contract` dependencies.

The consuming Expo app receives public configuration only:

```dotenv
EXPO_PUBLIC_MOBILE_SYNC_URL=https://your-worker.your-subdomain.workers.dev
EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS=google
```

Compile the app's stable scheme into a development build and pass the same
scheme to `createExpoAuthClient`. Expo Go is not a production OAuth verification
target. Keep login and remote sync optional so the host app continues working
offline.

## 8. Production verification

Before serving real users, verify on every supported native platform:

- successful, cancelled, and denied provider login
- callback return, session restoration, logout, and revoked sessions
- explicit account linking and last-provider unlink protection
- two-user isolation, mutation replay, conflict handling, and pagination
- complete account deletion and provider unlink state
- privacy disclosure for every field the host app elects to upload
- backup, restore, migration, and secret-rotation procedures

This starter is not a warranty, managed service, or substitute for the adopter's
own security and privacy review.

## Official references

- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Cloudflare D1 migration commands](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo)
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
