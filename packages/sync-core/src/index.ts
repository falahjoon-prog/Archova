// Offline sync engine shared by mobile (and web later): device outbox, pull loop, lost access and drain
// mode (ADR-0006, mobile 02). Platform-free: the app supplies the store (encrypted SQLite) and transport.

export * from './wire';
export * from './store';
export * from './transport';
export * from './backoff';
export * from './engine';
export * from './scheduler';
export { MemorySyncStore, type LocalRecord, type MemorySyncStoreOptions } from './memory-store';
