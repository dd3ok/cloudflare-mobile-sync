# Architecture

Reviewed: 2026-08-19

## System boundary

```text
Host Android app
  local database
  Credential Manager adapter
  @cloudflare-mobile-sync/expo-client
             |
             | HTTPS + Better Auth session cookie
             v
Cloudflare Worker
  strict native-auth guard
  Better Auth 1.6.23
  user-scoped sync repository
             |
             v
isolated D1 database
```

One deployment instance serves one host application and one environment. Dev
and production do not share a Worker, D1 database, rate-limit namespace, Google
Cloud project, Web client, Android client, application ID, session secret, or
data namespace.

## Authentication flow

1. The Expo adapter asks the Worker for a native Google attempt.
2. The Worker creates 32 random nonce bytes, stores only its digest in D1, and
   returns the nonce, attempt ID, and configured Web client ID.
3. The host adapter configures Android Credential Manager with that Web client
   ID and nonce, then obtains a Google ID token.
4. The Worker accepts only the exact Google direct-ID-token body and atomically
   consumes the attempt.
5. Better Auth verifies the token and Google `sub`, then creates or finds the
   `(providerId = google, accountId = sub)` account and a D1 session.
6. `@better-auth/expo` stores the service session cookie in SecureStore.

The Worker does not implement JWT verification, OAuth code exchange, or cookie
signing. Better Auth owns those primitives. The small nonce ledger adds replay
state that Better Auth 1.6.23 does not persist.

## Module boundaries

- `api-contract` owns portable runtime schemas and limits.
- `client-core` owns platform-neutral transport, retry, and sync state.
- `expo-client` owns SecureStore session integration and a narrow
  `NativeGoogleCredentialProvider` interface.
- The host app owns the selected native Credential Manager library and its Expo
  config plugin. Native-library types do not cross the adapter seam.
- The Worker owns request validation, authorization, D1 persistence, and
  deletion receipts.
- The private deployment repository owns resource identities, public domains,
  environment mapping, exact source pins, secrets requirements, and evidence.

This keeps the portable packages usable from future native Android, Swift,
Flutter, or bare React Native adapters without importing Expo or Cloudflare
runtime APIs.

## Data model

Better Auth owns `user`, `account`, `session`, and its support tables. The
platform owns `native_google_auth_attempt`, sync records/change receipts,
retained tombstone receipts, and account deletion receipts.

Provider token columns remain nullable and must be null after native Google
sign-in. Sync identity is `(session user, collection, recordId)`. Provider email
is mutable profile data; Google `sub` is the provider account identity.

## Historical compatibility

The PKCE browser handoff is removed from runtime and active documentation.
Migration `0004_mobile_auth_handoff.sql` and ADRs 0008/0009 remain immutable
history only. ADR 0014 is authoritative.
