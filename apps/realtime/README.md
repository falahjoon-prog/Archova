# apps/realtime (not started)

WebSocket gateway (ADR-0004 §6): cookie + strict `Origin` check for web, token-in-first-message for mobile, hints only (clients refetch over REST). Subscribes to the `identity:session-revoked` Valkey channel that `@archova/mod-identity` already publishes on, and closes affected sockets. Owner: Ben.
