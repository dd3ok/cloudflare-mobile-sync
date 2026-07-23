# ADR 0006: Local account deletion is not blocked by provider outages

- Status: accepted
- Date: 2026-07-23
- Supersedes: the provider-outage behavior in ADR 0003

## Decision

Remote account deletion still requires a fresh authenticated session. The Worker
first makes a best-effort attempt to revoke each provider grant, then deletes the
local Better Auth user and all D1 data connected through foreign-key cascades.

A provider timeout or error is recorded without tokens, account identifiers, or
user data, but it does not block local deletion. A missing local user remains an
error so an ambiguous deletion result is never reported as success.

## Rationale

An external provider outage must not prevent a user from deleting data controlled
by this deployment. Keeping an encrypted revocation outbox would retain provider
tokens and add a queue, retry policy, and operational burden before there is
evidence that this complexity is needed.

## Consequences

- A provider grant can remain active after local data has been deleted.
- Operators can use the privacy-safe provider failure warning to detect recurring
  revocation problems.
- Provider-console unlink webhooks remain the preferred way to receive later
  provider-side withdrawal events when a provider supports them.
