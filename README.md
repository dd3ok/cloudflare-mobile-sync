# Cloudflare Mobile Sync

English | [한국어](./README.ko.md)

A small, self-hosted authentication and incremental-sync starter for mobile apps. Each adopter deploys one Worker and one D1 database to a Cloudflare account they control. This repository does not operate a shared service.

The HTTP protocol is platform-neutral. Expo SDK 57 is the first adapter, while portable schemas and sync orchestration stay independent of Expo, React Native, Node.js, and Cloudflare runtime APIs.

## What is implemented

- Better Auth 1.6.23 with database sessions and direct D1 support
- Google, Kakao OIDC, and Naver OAuth server adapters
- Expo SDK 57 SecureStore plus a one-time S256-bound HTTPS mobile session exchange
- Compare-and-set record sync with idempotent mutations, exact-collection cursor pulls, and privacy-compacted tombstones
- D1 migrations, user-scoped queries, rate limits, runtime validation, and stable errors
- Local-first Expo example that works before login and syncs only on request
- Workers-runtime integration tests including cross-user and deletion failures

A maintainer-owned legacy reference instance remains deployed for its original
clients. The isolated `byulsataro-sync-production` Worker and APAC D1 database
were provisioned on 2026-08-18 with migrations 0001 through 0006, four required
Worker secrets, the exact production app scheme and Google callback. Its health
and remote preflight checks pass; consumer artifact activation and physical
Android reinstall/device-transfer verification remain separate release gates.
It is not a public sandbox: do not point another application at it. Real Google
sign-in, redirect return, session restoration, and logout were previously
verified on Android through the legacy Byulsata Expo consumer. The ANT HELL Godot consumer has
also verified Android sign-in and callback return against an isolated Worker
and D1 deployment. Account-deletion regression checks and iOS verification
remain, so this source release does not claim full provider or platform
production readiness. Kakao and Naver remain unconfigured.

## Workspace

```text
apps/worker               Cloudflare Worker, Better Auth, D1 migrations
packages/api-contract     portable Zod schemas and TypeScript types
packages/client-core      injected HTTP transport, retry, and sync orchestration
packages/expo-client      Expo SecureStore, linking, and auth adapter
examples/expo-app         local-first end-to-end reference app
docs                      architecture, security, API, operations, and ADRs
```

## Quick start

Requirements: Node.js 22.13–24 and pnpm 11.9.0.

```bash
pnpm install
pnpm --filter @cloudflare-mobile-sync/worker migrate:local
pnpm --filter @cloudflare-mobile-sync/worker dev
```

Copy `apps/worker/.dev.vars.example` to `apps/worker/.dev.vars` and replace placeholders locally. Never commit that file. In another terminal:

```bash
pnpm --filter @cloudflare-mobile-sync/expo-app dev
```

The Expo example needs `EXPO_PUBLIC_MOBILE_SYNC_URL`; copy
`examples/expo-app/.env.example` to `.env.local` and use an address reachable
from the selected simulator or device. Leave
`EXPO_PUBLIC_MOBILE_SYNC_PROVIDERS` empty for local-only use, then set it to
`google` after Google credentials are configured on the Worker. OAuth callbacks
require an Expo development build with the compiled
`com.example.cloudflaremobilesync`
scheme. Expo Go is not a valid OAuth verification target.

## Self-hosting

Start with [the self-hosting guide](./docs/SELF_HOSTING.md). The committed
Wrangler configuration describes the maintainer reference deployment, so every
adopter must replace its Worker name, D1 database, public origin, app origins,
and provider secrets before using a remote command.

The first public distribution is source-only pre-release software. Workspace
packages intentionally remain `private: true` and are not available from npm.
See [the public-release checklist](./docs/PUBLIC_RELEASE.md) for release status
and the provider/platform verification that remains.

## Quality commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:preflight
pnpm security:secrets
pnpm security:audit
pnpm check
```

See [configuration](./docs/CONFIGURATION.md), [API](./docs/API.md),
[operations](./docs/OPERATIONS.md), [provider setup](./docs/PROVIDERS.md),
[security model](./docs/SECURITY.md), [sync retention](./docs/SYNC_RETENTION.md),
[security reporting](./SECURITY.md), [domain language](./CONTEXT.md),
[deployment-boundary ADR](./docs/adr/0013-public-platform-private-product-deployments.md), and
[research baseline](./docs/RESEARCH.md).

The maintainer's isolated consumer deployments are documented separately. See
[ANT HELL deployment](./docs/ANT_HELL_DEPLOYMENT.md) for its authentication-only
configuration; it does not share the Byulsata Worker or D1 database.

## Deliberate limits

This is not Firebase, a CRDT engine, a shared multi-tenant SaaS, or a realtime subscription service. Sync payloads are opaque JSON in allowlisted collections. Conflicts are returned to the host app for an explicit record-level choice. Tombstones are retained indefinitely until a separate stale-device reset protocol is designed.

## License

The source code is available under the [MIT License](./LICENSE). Package
manifests remain private to prevent accidental npm publication; source licensing
does not turn the maintainer deployment into a hosted service.
