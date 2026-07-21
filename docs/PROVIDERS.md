# OAuth provider setup and verification

Reviewed: 2026-07-21

Provider applications and secrets are owner-controlled external resources. The repository does not create them. Enable only providers for which both client ID and client secret are set.

## Callback model

Providers return to the Worker. Better Auth validates the provider response, creates the database session, and then returns to the allowlisted app callback such as `cloudflare-mobile-sync://auth/callback`.

For a deployed Worker origin `https://sync.example.com`, register these exact provider callbacks:

| Provider | Worker callback |
| --- | --- |
| Google | `https://sync.example.com/v1/auth/callback/google` |
| Kakao | `https://sync.example.com/v1/auth/oauth2/callback/kakao` |
| Naver | `https://sync.example.com/v1/auth/oauth2/callback/naver` |

Set `BETTER_AUTH_URL=https://sync.example.com` without the `/v1/auth` suffix. Put the app scheme or universal-link origin in `TRUSTED_ORIGINS`; do not use a wildcard credentialed origin.

Keep the consuming app's public provider list aligned with the server. Leave it
empty for local-only use, set `EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS=google` after
Google Worker secrets are configured, then append `kakao` and `naver` only after
their secrets and real-device verification are complete. This value controls UI
exposure only and is not an authorization boundary.

## Google

Create a web OAuth client, register the exact Worker callback, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Worker secrets. The adapter requests `openid`, `email`, and `profile` and uses Better Auth's maintained Google provider.

## Kakao

Enable Kakao Login and OpenID Connect, register the exact Worker callback, and configure consent for the profile fields actually needed. The adapter uses Kakao OIDC discovery with PKCE and maps only subject, nickname, profile image, and optional email.

Set `KAKAO_CLIENT_ID` and `KAKAO_CLIENT_SECRET` as Worker secrets. If the application does not issue a Kakao client secret, the current server configuration must be reviewed rather than placing a public mobile key into the secret field by assumption.

## Naver

Register the Worker callback in Naver Developers, request the minimum profile fields, and set `NAVER_CLIENT_ID` and `NAVER_CLIENT_SECRET` as Worker secrets. Naver uses explicit authorization, token, and profile endpoints rather than an OIDC discovery document in this implementation.

Naver provider terms restrict collection and use of profile data. This starter maps only the provider subject, nickname/name, profile image, and optional email. Review the provider's current terms and application review requirements before production use.

## Verification status

| Capability | Local status | Still required |
| --- | --- | --- |
| Better Auth/D1 schema and session route integration | built, Workers-runtime tested, and deployed to the maintainer reference instance | each adopter's production URL and secrets |
| Expo callback construction and SecureStore adapter | typechecked; web UI bundled | iOS/Android development build |
| Google authorization and callback | implemented; maintainer credentials and callback configured | real-account consent/cancel/revoke tests |
| Kakao OIDC and unlink | implemented | Kakao console enablement and real-account tests |
| Naver OAuth and token deletion | implemented | Naver app review, real-account and error-response tests |

Before declaring a provider production-ready, test successful sign-in, denied consent, user cancellation, mismatched callback rejection, restored session after restart, logout, expired/revoked token handling, explicit linking, last-provider unlink protection, provider outage, and complete account deletion on both iOS and Android.

Official references are collected in [RESEARCH.md](./RESEARCH.md).
