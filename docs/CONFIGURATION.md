# Configuration contract

Reviewed: 2026-08-19

Configuration is split by trust boundary. Portable packages accept explicit
options and never read environment variables.

## Worker bindings

| Name | Kind | Purpose |
| --- | --- | --- |
| `DB` | D1 binding | isolated service database |
| `AUTH_RATE_LIMITER` | binding | authentication abuse limit |
| `SYNC_RATE_LIMITER` | binding | sync write/read limit |
| `ALLOWED_COLLECTIONS` | public var | exact sync collection allowlist |
| `RETAINED_TOMBSTONE_TARGETS` | public var | optional strict compaction targets |
| `BETTER_AUTH_URL` | public var | canonical HTTPS Worker origin |
| `TRUSTED_ORIGINS` | public var | exact Better Auth origins; no wildcard |
| `GOOGLE_WEB_CLIENT_ID` | public var | Google ID-token audience |
| `NATIVE_APPLICATION_ID` | public var | exact Android application ID |
| `BETTER_AUTH_SECRET` | Worker secret | active session-signing secret |
| `BETTER_AUTH_SECRETS` | Worker secret | versioned rotation keyring |

There is no `GOOGLE_CLIENT_SECRET`, generic `*_CLIENT_ID`, provider refresh
token, or OAuth callback variable in the native baseline. The Web client ID is
not a secret and is returned to the app as part of a nonce attempt.

`BETTER_AUTH_URL` is one canonical custom-domain origin such as
`https://sync.example.com`. Do not mix a custom domain, `workers.dev`, and a
different app URL in one environment. Product deployments should set
`workers_dev: false` and `preview_urls: false` after the custom domain is ready.

## Environment isolation

Every environment has its own:

- Google Cloud project;
- Web OAuth client ID;
- Android OAuth client bound to exact package and signing SHA-1;
- Worker, D1 database, rate-limit namespaces, custom domain, application ID,
  collection namespace, and Better Auth secrets.

A deployment accepts one Web audience only. Do not add dev and production client
IDs to one Better Auth configuration.

## Expo consumer

The consuming app needs only public values:

```dotenv
EXPO_PUBLIC_MOBILE_SYNC_URL=https://sync.example.com
EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS=google
```

The native application ID remains in Expo config. The Worker returns the Web
client ID at sign-in, so the app does not need a second copy. All
`EXPO_PUBLIC_*` values are visible in the bundle; never place secrets or tokens
there.

Use an Expo development or release build. Expo Go cannot load the Credential
Manager native module. `react-native-nitro-google-signin` 2.0.0 and
`react-native-nitro-modules` 0.36.5 are exact pins in the reference app.

## Deployment ownership

The committed `apps/worker/wrangler.jsonc` is a local/example config only.
Product configs belong in a private deployment repository and must pin this
repository by full commit plus migration hashes. Never restore real product D1
IDs or Google project identities to this public source repository.
