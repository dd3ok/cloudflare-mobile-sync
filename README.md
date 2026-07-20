# Cloudflare Mobile Sync

Cloudflare Mobile Sync is an incubating, self-hosted backend starter for mobile applications. Each adopter deploys an isolated Cloudflare Worker and D1 database to their own Cloudflare account instead of connecting to a shared multi-tenant service.

The backend is platform-neutral. The first supported client is Expo, with the portable sync and API layers kept separate so web, bare React Native, Flutter, Swift, and Android clients can be added later.

## Intended architecture

```text
Expo app / future clients
        |
        | HTTPS
        v
Cloudflare Worker
  - authentication and OAuth callbacks
  - authorization and validation
  - incremental sync API
        |
        v
Cloudflare D1
  - auth data
  - per-user records and tombstones
```

The proposed workspace layout is:

```text
apps/worker               Cloudflare Worker API
packages/api-contract     portable request/response schemas and types
packages/client-core      platform-neutral API and sync client
packages/expo-client      Expo SecureStore, linking, and OAuth adapter
examples/expo-app         minimal end-to-end example
docs                      architecture, security, and operational guidance
```

## Goals

- Self-hosted deployment to the adopter's own Cloudflare account
- Cloudflare Workers and D1 with no always-on server process
- Google, Kakao, and Naver authentication through maintained authentication primitives
- Local-first, cursor-based incremental synchronization
- Strict per-user data isolation and complete account-data deletion
- Expo-first SDK without coupling the backend protocol to Expo
- Reproducible migrations, automated tests, and documented deployment

## Non-goals

- Operating a shared authentication or database SaaS
- Reimplementing OAuth, token signing, or cryptographic primitives
- Direct D1 access from an untrusted mobile client
- Depending on Byulsata-specific astrology, saju, or tarot data models
- Supporting every client platform in the first release

## Status

The repository is currently documentation-only. No production implementation, Cloudflare resources, OAuth applications, or secrets have been created.

Start with [HANDOFF.md](./HANDOFF.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## License

No open-source license has been selected yet. The repository is private during incubation. Choose and add a license explicitly before making it public.
