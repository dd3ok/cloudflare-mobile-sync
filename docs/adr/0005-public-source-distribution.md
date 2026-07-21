# ADR 0005: Distribute a public self-hosted source starter

Status: accepted

Reviewed: 2026-07-21

## Context

Other developers should be able to use the generic authentication and sync
implementation. Letting unrelated applications call the maintainer's deployed
Worker would mix accounts, quotas, deletion scope, and application data in one
service. Publishing all SDK packages to npm now would add versioning and support
work before a real host app has completed the provider/device gate.

## Decision

- License the repository source under MIT.
- Prepare the repository for public visibility as a CLI-first self-hosted
  starter.
- Require every adopter to deploy an independent Worker and D1 database and to
  create their own provider applications and secrets.
- Keep every workspace package `private: true` and unpublished for the first
  source release. Developers can fork the workspace, use its HTTPS contract, and
  run the included Expo example without an npm release.
- A separately owned first-party app may vendor local archives of all three
  client packages built from one pinned commit. The archives must use built
  `dist` exports, include their MIT notices, and be locked by the consumer. This
  does not make the packages public or establish a compatibility promise.
- Keep the maintainer deployment private to its intended apps; it is a reference
  deployment, not a public sandbox or shared SaaS.
- Require the public-release checklist before changing repository visibility or
  creating the first tag.

## Consequences

The first distribution remains small: source, documentation, tests, and a
reproducible per-adopter deployment. It avoids tenant provisioning, billing,
shared-service incident response, and premature package compatibility promises.

Adopters must own Cloudflare operations, OAuth configuration, privacy terms,
backups, provider reviews, and end-user support. Separate repositories may use
the HTTP contract or the complete pinned archive set; copying one internal
package in isolation is not a supported installation method.

## Sources

- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo)
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
