// ─── Core Configuration ─────────────────────────────────────────────────────

/**
 * Configuration options for initializing a GaaS instance.
 */
export interface GaaSConfig {
  /** GitHub Personal Access Token. Falls back to GAAS_TOKEN env var. */
  token?: string;
  /** GitHub repository name. Falls back to GAAS_REPO env var. */
  repo?: string;
  /** GitHub username or org. Falls back to GAAS_OWNER env var. */
  owner?: string;
  /** Branch to use (default: 'main'). Falls back to GAAS_BRANCH env var. */
  branch?: string;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Encryption configuration */
  encryption?: EncryptionConfig;
}

export interface RetryConfig {
  /** Enable auto-retry (default: true) */
  enabled?: boolean;
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Backoff strategy (default: 'exponential') */
  backoff?: 'exponential' | 'linear' | 'fixed';
  /** Base delay in ms (default: 1000) */
  baseDelay?: number;
}

export interface EncryptionConfig {
  /** Enable encryption (default: false) */
  enabled: boolean;
  /** AES-256-GCM encryption key (32 bytes / 64 hex chars). Falls back to GAAS_ENCRYPTION_KEY env var. */
  key?: string;
}

// ─── Resolved config (after defaults + env vars) ────────────────────────────

export interface ResolvedConfig {
  token: string;
  repo: string;
  owner: string;
  branch: string;
  debug: boolean;
  retry: Required<RetryConfig>;
  encryption: { enabled: boolean; key: string | null };
}

// ─── Collection Types ───────────────────────────────────────────────────────

export interface CollectionOptions<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Schema for validation */
  schema?: SchemaDefinition;
  /** Lifecycle hooks */
  hooks?: CollectionHooks<T>;
}

export interface CollectionHooks<T extends Record<string, unknown> = Record<string, unknown>> {
  beforeCreate?: (data: T) => T | Promise<T>;
  afterCreate?: (record: T) => void | Promise<void>;
  beforeUpdate?: (id: string, changes: Partial<T>) => Partial<T> | Promise<Partial<T>>;
  afterUpdate?: (record: T) => void | Promise<void>;
  beforeDelete?: (id: string) => void | Promise<void>;
  afterDelete?: (id: string) => void | Promise<void>;
}

export interface QueryOptions<T = Record<string, unknown>> {
  where?: WhereClause<T>;
  sort?: SortClause<T>;
  limit?: number;
  offset?: number;
}

export type WhereClause<T> = {
  [K in keyof T]?: T[K] | WhereOperator<T[K]>;
};

export interface WhereOperator<V = unknown> {
  $eq?: V;
  $ne?: V;
  $gt?: V;
  $gte?: V;
  $lt?: V;
  $lte?: V;
  $in?: V[];
  $nin?: V[];
  $contains?: string;
  $startsWith?: string;
  $endsWith?: string;
  $exists?: boolean;
}

export type SortClause<T> = {
  [K in keyof T]?: 'asc' | 'desc';
};

// ─── Schema Types ───────────────────────────────────────────────────────────

export type SchemaFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface SchemaFieldDefinition {
  type: SchemaFieldType;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  email?: boolean;
  url?: boolean;
  items?: SchemaFieldDefinition;
  properties?: Record<string, SchemaFieldDefinition>;
}

export type SchemaDefinition = Record<string, SchemaFieldDefinition>;

// ─── GitHub Types ───────────────────────────────────────────────────────────

export interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  content?: string;
  encoding?: string;
  download_url: string | null;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
}

export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  used: number;
  resetsAt: string;
}

export interface HealthStatus {
  connected: boolean;
  repo: string;
  owner: string;
  branch: string;
  rateLimit: GitHubRateLimit;
}

// ─── Cache Types ────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  data: T;
  sha: string;
  timestamp: number;
  ttl: number;
}

// ─── Storage Types ──────────────────────────────────────────────────────────

export interface StorageFileInfo {
  name: string;
  path: string;
  size: number;
  sha: string;
  downloadUrl: string | null;
  type: 'file' | 'dir';
}

// ─── Import/Export Types ────────────────────────────────────────────────────

export type ImportExportFormat = 'json' | 'csv';

export interface ImportOptions {
  /** Format of the source file (auto-detected from extension if omitted) */
  format?: ImportExportFormat;
  /** Clear existing records before importing (default: false) */
  clear?: boolean;
  /** Custom ID field name in the source data (default: 'id') */
  idField?: string;
}

export interface ExportOptions {
  /** Export format (default: 'json') */
  format?: ImportExportFormat;
  /** Query filter to export only matching records */
  where?: WhereClause<Record<string, unknown>>;
}

// ─── Validation Types ───────────────────────────────────────────────────────

export interface ValidationFieldError {
  field: string;
  message: string;
  expected?: string;
  received?: string;
}
