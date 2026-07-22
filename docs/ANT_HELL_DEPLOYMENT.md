# ANT HELL deployment

Reviewed: 2026-07-23

ANT HELL reuses this repository's platform-neutral Worker while keeping its
users, sessions, rate limits, and deletion scope isolated from every other host
application.

## Resources

- Worker: `ant-hell-sync`
- Worker origin: `https://ant-hell-sync.ponntailstudio.workers.dev`
- D1 database: `ant-hell-sync-prod`
- Wrangler configuration: `apps/worker/wrangler.ant-hell.jsonc`
- Native callback origin: `com.dd3ok.anthell://`
- OAuth callback: `https://ant-hell-sync.ponntailstudio.workers.dev/v1/auth/callback/google`

## Current status

The Worker, D1 database, migrations, independent Better Auth secrets, and
Google provider bindings are deployed. Health, signed-out session, protected
account rejection, and Google login-start responses pass. Android real-account
sign-in and native callback return have also been verified.

A dedicated Web OAuth client named `ANT HELL` was created on 2026-07-22 with the
exact callback above. Its ID and secret were sent directly to encrypted Worker
secrets without adding them to either repository. The public login flow reaches
Google without `invalid_client` or `redirect_uri_mismatch` and returns to the
Android app. Session restoration, logout, cancellation, and deletion regression
checks remain before ANT HELL can claim production-ready authentication.

`ALLOWED_COLLECTIONS` is intentionally empty. The first integration uses only
authentication and account management; ANT HELL does not upload game progress
or play history. Add a collection only after defining its payload, privacy
disclosure, conflict policy, and tests.

## Deploy and migrate

Run these commands from this repository. Never put the values used by these
commands in the ANT HELL mobile bundle.

```powershell
pnpm --filter @cloudflare-mobile-sync/worker build:ant-hell
pnpm --filter @cloudflare-mobile-sync/worker migrate:ant-hell:remote
pnpm --filter @cloudflare-mobile-sync/worker deploy:ant-hell
```

The ANT HELL Worker requires independent `BETTER_AUTH_SECRET` and
`BETTER_AUTH_SECRETS` values. Use an owner-controlled Web OAuth client whose
consent-screen branding is suitable for ANT HELL and register the exact callback
above in Google Cloud.

After deployment, verify `/health`, the signed-out `/v1/auth/get-session`
response, the unauthenticated `401` response from `/v1/account`, and the complete
physical-device login, callback, session restoration, logout, and account
deletion flow.

## Consumer boundary

The Godot application owns its Android secure-cookie store and deep-link
adapter. It uses the same `/v1/auth/*` and `/v1/account` HTTP contract as the
Expo adapter but does not copy or fork the Worker implementation into the game
repository. Pin the backend source commit in the ANT HELL handoff whenever this
deployment changes.
