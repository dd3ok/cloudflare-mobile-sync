# Security model

Reviewed: 2026-08-19

## Trust boundaries

- The app, local data, request bodies, cursors, provider responses, and network
  failure states are untrusted.
- The Worker is the authorization boundary. It validates input and derives the
  user from a Better Auth session before application-data access.
- D1 and Worker secrets are server-side resources and never enter the app.
- Google signs identity tokens; Better Auth validates them. Email is profile
  data, not an account key.

## Principal controls

| Threat | Control |
| --- | --- |
| Stolen/replayed Google token | server-issued 256-bit nonce, five-minute TTL, digest-only D1 storage, atomic one-time consumption, Better Auth nonce and JWT verification |
| Browser OAuth bypass | strict direct-ID-token body; callback and link routes return `404` |
| Provider token exposure | access/refresh token fields and caller profiles rejected; native branch stores no provider token in D1 |
| Cross-user access | no application API accepts `userId`; every SQL operation is session-user scoped |
| Account takeover by email | provider identity is `(google, sub)`; implicit email linking disabled |
| Secret leakage | only Better Auth keys are Worker secrets; logging excludes tokens, cookies, bodies, and provider profiles |
| Oversized or malformed input | bounded streaming body parser plus strict Zod schemas and field limits |
| Abuse | Cloudflare auth/sync rate-limit bindings and Better Auth route limits |
| Account deletion race | expected-subject header, fresh session, durable operation ID, cascading D1 deletion, recoverable PII-free receipt |
| Stale security rows | once-per-minute cleanup for nonce attempts and deletion receipts |

## Token policy

The client submits only the Google ID token and nonce required for authentication.
The Worker rejects access tokens, refresh tokens, expiry metadata, and
caller-supplied profiles. Better Auth uses the ID token transiently to verify the
identity and create a service session; the ID token is not persisted in the
account row.

The Better Auth session cookie is still a bearer secret. It is stored in Expo
SecureStore, sent only over HTTPS, never logged, and revoked on sign-out or
account deletion.

## Known conditional risk

`react-native-nitro-google-signin` 2.0.0 is new. It is isolated behind
`NativeGoogleCredentialProvider` and is not considered production-approved until
the signed physical-device gate passes. The replacement boundary is deliberately
small so a standalone Expo Module can replace it without changing server or
portable sync contracts.

Expo/Metro currently brings `image-size` into the build toolchain. Its ICNS,
HEIF, and JXL parsers have two high-severity infinite-loop advisories, and no
patched npm release is available. This code is not part of the deployed Worker
runtime; builds accept only reviewed repository assets and CI has a hard
timeout. The exact exceptions are fail-closed after 2026-09-12 UTC and must be
removed as soon as Expo/Metro publishes a patched dependency path. Do not run
the bundler against untrusted image inputs. See
[GitHub Advisory Database issue 9028](https://github.com/github/advisory-database/issues/9028)
and [Expo issue 48670](https://github.com/expo/expo/issues/48670).

## Historical migration

The old browser handoff runtime is gone. `0004_mobile_auth_handoff.sql` remains
unchanged only because migration history is append-only; its table is unused by
active code. ADR 0014 is the current security decision.
