// ─── GaaS — Public API ──────────────────────────────────────────────────────
//
// This is the main entry point for the package.
// Everything users need is re-exported from here.
//
// Usage:
//   import { GaaS, Schema } from 'gaas';

// Main class
export { GaaS } from './gaas.js';

// Schema builder
export { Schema, validateData } from './schema.js';

// Sub-modules (for advanced usage / typing)
export { Collection } from './collection.js';
export { KVStore } from './kv-store.js';
export { Storage } from './storage.js';
export { Encryption } from './encryption.js';

// Error classes
export {
  GaaSError,
  ConfigError,
  AuthenticationError,
  RateLimitError,
  ConflictError,
  NotFoundError,
  ValidationError,
  EncryptionError,
  GitHubApiError,
} from './errors.js';

// Types
export type {
  GaaSConfig,
  ResolvedConfig,
  RetryConfig,
  EncryptionConfig,
  CollectionOptions,
  CollectionHooks,
  QueryOptions,
  WhereClause,
  WhereOperator,
  SortClause,
  SchemaDefinition,
  SchemaFieldDefinition,
  SchemaFieldType,
  GitHubRateLimit,
  HealthStatus,
  StorageFileInfo,
  ImportOptions,
  ExportOptions,
  ImportExportFormat,
  ValidationFieldError,
} from './types.js';
