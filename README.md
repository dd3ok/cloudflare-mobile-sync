# Cloudflare Mobile Sync

A small, self-hosted authentication and incremental-sync starter for mobile apps. Each adopter deploys one Worker and one D1 database to a Cloudflare account they control. This repository does not operate a shared service.

The HTTP protocol is platform-neutral. Expo SDK 57 is the first adapter, while portable schemas and sync orchestration stay independent of Expo, React Native, Node.js, and Cloudflare runtime APIs.

## What is implemented

- Better Auth 1.6.23 with database sessions and direct D1 support
- Google, Kakao OIDC, and Naver OAuth server adapters
- Expo SDK 57 SecureStore cookie bridge and stable app-scheme callbacks
- Compare-and-set record sync with idempotent mutations, cursor pulls, and tombstones
- D1 migrations, user-scoped queries, rate limits, runtime validation, and stable errors
- Local-first Expo example that works before login and syncs only on request
- Workers-runtime integration tests including cross-user and deletion failures

The owner instance is deployed at
`https://cloudflare-mobile-sync.ponntailstudio.workers.dev`, its D1 migrations
are applied, and Google OAuth credentials and the Worker callback are configured.
Real Google sign-in, redirect return, session restoration, and account deletion
still need end-to-end verification in an Expo development build before the
provider is considered production-ready. Kakao and Naver remain unconfigured.

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
require an Expo development build with the compiled `cloudflare-mobile-sync`
scheme. Expo Go is not a valid OAuth verification target.

## Quality commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm security:secrets
pnpm security:audit
pnpm check
```

See [configuration](./docs/CONFIGURATION.md), [API](./docs/API.md),
[operations](./docs/OPERATIONS.md), [provider setup](./docs/PROVIDERS.md),
[security model](./docs/SECURITY.md), and
[research baseline](./docs/RESEARCH.md).

## Deliberate limits

This is not Firebase, a CRDT engine, a shared multi-tenant SaaS, or a realtime subscription service. Sync payloads are opaque JSON in allowlisted collections. Conflicts are returned to the host app for an explicit record-level choice. Tombstones are retained indefinitely until a separate stale-device reset protocol is designed.

## License

V1 distribution policy is private and unpublished: every workspace package has
`private: true`, and no open-source license is selected. Reconsider visibility,
licensing, and npm publication only after a real host app and the supported OAuth
providers pass end-to-end verification.
