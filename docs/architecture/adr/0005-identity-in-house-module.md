# ADR-0005: Identity as an in-house module behind a provider-neutral interface

- **Status:** Accepted (architecture); cost/staffing confirmation from john welcome
- **Date:** 2026-10-02
- **Deciders:** Ava, Sam. Input from Ben.
- **Affects:** backend, security, mobile, web

## Context
Ben proposed a managed OIDC provider (WorkOS, or Clerk). Sam recommended our own identity module using maintained libraries. Requirements: identity data in AWS Sydney, SSO (SAML/OIDC) and SCIM for enterprise builders, passkeys, cost that stays flat at 100,000+ users, and instant session revocation (ADR-0004).

## Decision
- Build an `identity` module in the modular monolith (sessions, credentials, MFA, passkeys, OAuth authorisation server for mobile and public API), using maintained libraries only: `@simplewebauthn` (passkeys), `otplib`/`oslo` (TOTP), Argon2id for passwords, a self-hosted SAML/OIDC broker (e.g. BoxyHQ SAML Jackson) for enterprise SSO, and our own SCIM endpoint.
- All identity code sits behind an `IdentityProvider` interface so a managed broker (WorkOS) can replace the SSO/SCIM part later without touching other modules.
- Add `identity` to the module catalogue in [backend-modules.md](../backend-modules.md); it is a global (non-tenant) module living in the global layer of the cell design.

## Alternatives considered
- **WorkOS / Clerk:** faster SSO and SCIM, but per-connection or per-user pricing at scale, identity data outside our Sydney stack, and session control split across two systems.
- **Cognito:** in-region, but limited SAML/SCIM ergonomics and awkward customisation.

## Consequences
- Security-sensitive code we own: requires Sam's review on every change to `identity`, an external penetration test before phase 1 launch, and dependency monitoring.
- If security headcount is not available by phase 1, revisit: swap SSO/SCIM to WorkOS behind the same interface.
