# Public source release checklist

Reviewed: 2026-07-23

This checklist controls the first public source pre-release. It does not
authorize a shared hosted service or npm publication. Source visibility and
provider/platform production-readiness are separate claims.

## Completed before publication

- [x] MIT license
- [x] self-hosting and consumer configuration guides
- [x] security policy and private-reporting path
- [x] CI, dependency updates, tracked-tree secret scanning, and dependency audit
- [x] placeholder-only tracked secret examples
- [x] explicit warning that maintainer Workers are not public sandboxes
- [x] packages remain `private: true` to prevent accidental npm publication
- [x] Android real-account Google login, callback return, session restoration,
      and logout verified through the Byulsata Expo consumer
- [x] a second isolated Android consumer, ANT HELL, verified Google login and
      callback return through the platform-neutral HTTP contract
- [x] full Git history scanned with Gitleaks 8.30.1 in redaction mode; zero
      findings on 2026-07-23
- [x] README and release notes describe a self-hosted pre-release rather than a
      shared maintainer service

## Publication transition

- [x] commit and push the release candidate from a clean worktree
- [x] verify a clean clone can install, run `pnpm check`, run
      `pnpm security:audit`, migrate disposable local D1 state, and build the
      ANT HELL Worker configuration using only tracked documentation
- [x] make the GitHub repository public after the owner reviews this checklist
- [x] immediately enable Dependabot alerts, private vulnerability reporting,
      branch protection, and the required `verify` CI check
- [x] confirm public-repository CI passes
- [x] create a `v0.1.0` GitHub pre-release from the verified commit

GitHub Free does not expose every required repository protection while this
personal repository is private. Those settings are applied and verified
immediately after the visibility transition, before the pre-release is created.

## Provider and platform verification still required

These items do not block honest source publication, but they do block the
corresponding production-readiness claim:

- [ ] reverify Android account deletion and deletion-followed-by-login after the
      deployed backend deletion fix
- [ ] verify ANT HELL session restoration, logout, cancellation, and deletion
      regressions on Android
- [ ] repeat the supported authentication, restoration, logout, and deletion
      flow on iOS before claiming iOS support is verified
- [ ] verify Kakao and Naver with production credentials and real accounts before
      calling either provider production-ready

## Deferred beyond the first source release

- npm publication of `api-contract`, `client-core`, or `expo-client`
- one-click Cloudflare deployment
- stability guarantees for the v1 API
- a shared hosted or multi-tenant service

Any future npm release needs independent package manifests, built `dist`
exports, versioning, changelogs, provenance, install tests outside this
workspace, and a separate owner decision.
