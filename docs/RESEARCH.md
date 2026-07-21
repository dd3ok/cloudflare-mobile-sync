# Compatibility research

Reviewed: 2026-07-21

This document records the current compatibility baseline used by the initial
implementation. Re-check these sources before dependency upgrades.

## Selected baseline

| Area | Selection | Status |
| --- | --- | --- |
| Runtime | Node.js 24 for development, Workers runtime in production | Node 24 satisfies Expo SDK 57's Node 22.13.x minimum |
| Mobile | Expo SDK 57 / React Native 0.86 | Supported; OAuth must be verified in a development build, not Expo Go |
| Authentication | `better-auth` and `@better-auth/expo` 1.6.23 | Current stable line; Expo's guide is still written for SDK 55, so SDK 57 integration remains a test gate |
| Database | Direct Better Auth D1 binding | First-party support exists since Better Auth 1.5; no community adapter is needed |
| Worker tests | Cloudflare Vitest integration | Runs tests in the Workers runtime with isolated storage |
| Google | Better Auth Google provider | First provider to verify end to end |
| Kakao | Generic OAuth using Kakao OIDC discovery | Requires Kakao Login and OIDC to be enabled in the provider console |
| Naver | Generic OAuth with explicit endpoints and a profile mapper | Official materials document OAuth endpoints but no OIDC discovery; real credentials are required for final verification |

## Package policy

- Pin direct dependencies exactly and commit `pnpm-lock.yaml`.
- Stay on Better Auth 1.6.x until 1.7 has a stable release and its migration and
  security notes have been reviewed.
- Use Better Auth's direct D1 binding instead of `better-auth-cloudflare`.
- Run `pnpm audit` and the full test suite before dependency updates are handed
  off.
- Distribute the first public release as MIT-licensed source. Keep workspace
  packages private and unpublished until external install tests and versioning
  are deliberately added.

## Expo findings

- A stable application scheme must be compiled into a development or production
  build. Expo Go callback URLs are not stable enough for authentication.
- The Expo adapter stores only Better Auth session cookies/cache in SecureStore.
  Application records remain in the host application's local database.
- SecureStore values are small, fallible credentials, not a source of truth.
  Android uninstall removes them; iOS may preserve Keychain items across an
  uninstall. Logout and an invalid server session must therefore clear the local
  cache explicitly.
- OAuth provider secrets and provider refresh tokens never enter the app bundle.

## Cloudflare findings

- Wrangler uses separate local D1 state; migrations must be applied explicitly
  with `wrangler d1 migrations apply ... --local`.
- D1 `batch()` is atomic but does not provide interactive transactions. Sync
  writes therefore use one guarded SQL statement and database triggers for the
  change log instead of a read-then-write transaction.
- Read replication is not enabled for v1. It would require D1 Sessions/bookmark
  propagation to maintain read-your-own-writes behavior.
- API limits are intentionally much smaller than platform maxima.

## Authentication findings

- Better Auth automatically links same-email OAuth accounts unless configured
  otherwise. This project sets `disableImplicitLinking: true`; linking is an
  explicit authenticated action.
- OAuth token encryption is off by default. This project enables
  `encryptOAuthTokens` and keeps encryption secrets in Worker secrets.
- Better Auth requires an email value on a user row, while Kakao and Naver users
  can withhold email. Provider adapters use a non-deliverable, internal
  deterministic `<provider>.<hash>@placeholder.invalid` fallback and never treat
  it as contact data.
- Provider identity is the stable `(providerId, providerSubject)` tuple. Email is
  mutable profile data and is never used for authorization.
- Better Auth's Expo cookie bridge is used instead of the bearer plugin. The
  platform-neutral client accepts an injected auth-header provider.

## Official sources

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Expo AuthSession](https://docs.expo.dev/versions/v57.0.0/sdk/auth-session/)
- [Expo Linking](https://docs.expo.dev/versions/v57.0.0/sdk/linking/)
- [Expo SecureStore for SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/)
- [Expo SQLite for SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/)
- [Expo AsyncStorage for SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/async-storage/)
- [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo)
- [Better Auth 1.5 D1 support](https://better-auth.com/blog/1-5)
- [Better Auth account linking](https://better-auth.com/docs/concepts/users-accounts)
- [Better Auth options](https://better-auth.com/docs/reference/options)
- [Better Auth June 2026 security update](https://better-auth.com/blog/security-update-june-2026)
- [Cloudflare D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare D1 Worker API](https://developers.cloudflare.com/d1/worker-api/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Kakao Login REST API](https://developers.kakao.com/docs/en/kakaologin/rest-api)
- [Kakao Login prerequisites](https://developers.kakao.com/docs/en/kakaologin/prerequisite)
- [Naver official OpenAPI endpoint list](https://github.com/naver/naver-openapi-guide/blob/master/ko/apilist.md)
- [Naver API terms](https://developers.naver.com/products/terms/)
