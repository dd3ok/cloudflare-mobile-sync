# Public source release checklist

Reviewed: 2026-07-21

This checklist controls the first public source release. It does not authorize a
shared hosted service or npm publication.

## Already prepared

- [x] MIT license
- [x] self-hosting and consumer configuration guides
- [x] security policy and private-reporting path
- [x] CI, dependency updates, secret-pattern scanning, and dependency audit
- [x] placeholder-only tracked secret examples
- [x] explicit warning that the maintainer Worker is not a public sandbox
- [x] packages remain `private: true` to prevent accidental npm publication

## Required before changing repository visibility

- [ ] complete a successful Google login, callback return, session restoration,
      logout, and account deletion in an Expo SDK 57 development build
- [ ] repeat the supported authentication and deletion flow on both Android and
      iOS before claiming both platforms are verified
- [ ] scan the full Git history with a dedicated secret-history scanner and
      resolve every finding without printing sensitive values
- [ ] verify a clean clone can install, run `pnpm check`, migrate disposable local
      D1 state, and start the example using only tracked documentation
- [ ] confirm repository settings enable private vulnerability reporting,
      Dependabot alerts, branch protection, and required CI checks
- [ ] review the README, issue tracker, and release notes so they do not present
      the maintainer deployment as a public service
- [ ] make the GitHub repository public only after the owner reviews this list
- [ ] create a `v0.1.0` pre-release tag from a clean, verified commit

## Deferred beyond the first source release

- npm publication of `api-contract`, `client-core`, or `expo-client`
- one-click Cloudflare deployment
- stability guarantees for the v1 API
- Kakao and Naver production-readiness claims before their real-account tests
- a shared hosted or multi-tenant service

Any future npm release needs independent package manifests, built `dist` exports,
versioning, changelogs, provenance, install tests outside this workspace, and a
separate owner decision.
