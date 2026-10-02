# ADR-0002: REST + JSON, contract-first with OpenAPI 3.1

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Ava, Ben, Felix, Mia
- **Affects:** backend, web, mobile, public API

## Context
Web, iOS/Android, internal tools and third-party integrations all consume the API. We want type safety end to end without tying external consumers to TypeScript.

## Decision
- REST over HTTPS with JSON, resource-oriented, versioned in the path (`/v1`).
- The OpenAPI 3.1 spec in `packages/contracts` is the source of truth. Server request validation, TypeScript types, zod schemas and `@archova/api-client` are generated from it; CI fails on stale generated code.
- Same endpoints serve first-party apps and the public API; internal endpoints are tagged `x-internal`.
- WebSocket only for change hints and notifications; no business writes over sockets.

## Alternatives considered
- **GraphQL:** flexible reads, but harder to rate-limit, cache, version and document for a public construction API; field-level authorisation adds complexity.
- **tRPC:** excellent DX but TypeScript-only; mobile works but public consumers do not.

## Consequences
- Contract changes go through the spec first (Ben owns the spec; front-end engineers review).
- Generated SDKs for the public API come almost free.
- Over-fetching is handled with `fields=` and `include=` conventions.
