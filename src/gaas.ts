// ─── GaaS — Main Entry Class ────────────────────────────────────────────────
//
// The main class users interact with. Handles config resolution, initialization,
// and provides access to collections, KV store, and storage.
//
// Usage:
//   const db = new GaaS({ token: 'ghp_xxx', repo: 'my-data', owner: 'user' });
//   const users = db.collection<User>('users');

import { GitHubClient } from './github-client.js';
import { Cache } from './cache.js';
import { Logger } from './logger.js';
import { Encryption } from './encryption.js';
import { Collection } from './collection.js';
import { KVStore } from './kv-store.js';
import { Storage } from './storage.js';
import { importFromFile, exportToFile } from './import-export.js';
import { ConfigError } from './errors.js';
import type {
  GaaSConfig,
  ResolvedConfig,
  CollectionOptions,
  HealthStatus,
  GitHubRateLimit,
  ImportOptions,
  ExportOptions,
} from './types.js';

export class GaaS {
  private config: ResolvedConfig;
  private github: GitHubClient;
  private cache: Cache;
  private logger: Logger;
  private encryption: Encryption | null;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  /** Tracked collection instances to avoid recreation */
  private collections: Map<string, Collection<any>> = new Map();
  private kvStore: KVStore | null = null;
  private storageInstance: Storage | null = null;

  constructor(config: GaaSConfig = {}) {
    this.config = this.resolveConfig(config);
    this.logger = new Logger(this.config.debug);
    this.cache = new Cache();
    this.encryption = this.config.encryption.enabled && this.config.encryption.key
      ? new Encryption(this.config.encryption.key)
      : null;
    this.github = new GitHubClient(this.config, this.cache, this.logger);

    this.logger.info(`GaaS initialized for ${this.config.owner}/${this.config.repo} (branch: ${this.config.branch})`);

    if (this.config.encryption.enabled) {
      this.logger.info('Encryption enabled (AES-256-GCM)');
    }
  }

  // ─── Lazy Initialization ──────────────────────────────────────────────

  /**
   * Ensures the repo and branch exist. Called automatically on first operation.
   * Can be called manually for eager initialization.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!this.initPromise) {
      this.initPromise = (async () => {
        await this.github.ensureRepo();
        await this.github.ensureBranch();
        this.initialized = true;
        this.logger.info('Initialization complete');
      })();
    }

    await this.initPromise;
  }

  // ─── Collections ──────────────────────────────────────────────────────

  /**
   * Get or create a collection (NoSQL document store).
   *
   * @example
   * const users = db.collection<User>('users');
   * const posts = db.collection('posts', { schema: postSchema });
   */
  collection<T extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    options?: CollectionOptions<T>
  ): Collection<T> {
    // Ensure initialization on first use
    this.triggerInit();

    const key = `${name}:${JSON.stringify(options || {})}`;
    if (!this.collections.has(key)) {
      this.collections.set(
        key,
        new Collection<T>(name, this.github, this.encryption, this.logger, this.cache, options)
      );
    }
    return this.collections.get(key)! as Collection<T>;
  }

  // ─── Key-Value Store ──────────────────────────────────────────────────

  /**
   * Get the key-value store instance.
   *
   * @example
   * const kv = db.kv();
   * await kv.set('config:theme', 'dark');
   */
  kv(): KVStore {
    this.triggerInit();

    if (!this.kvStore) {
      this.kvStore = new KVStore(this.github, this.encryption, this.logger, this.cache);
    }
    return this.kvStore;
  }

  // ─── File Storage ─────────────────────────────────────────────────────

  /**
   * Get the file storage instance.
   *
   * @example
   * const storage = db.storage();
   * await storage.upload('avatars/me.png', './photo.png');
   */
  storage(): Storage {
    this.triggerInit();

    if (!this.storageInstance) {
      this.storageInstance = new Storage(
        this.github,
        this.logger,
        this.config.owner,
        this.config.repo,
        this.config.branch
      );
    }
    return this.storageInstance;
  }

  // ─── Import / Export ──────────────────────────────────────────────────

  /**
   * Import records from a local file into a collection.
   *
   * @example
   * await db.import('users', './data/users.json');
   * await db.import('contacts', './data/contacts.csv', { clear: true });
   */
  async import<T extends Record<string, unknown>>(
    collectionName: string,
    filePath: string,
    options?: ImportOptions
  ): Promise<number> {
    await this.init();
    const col = this.collection<T>(collectionName);
    return importFromFile(col, filePath, options);
  }

  /**
   * Export collection records to a local file.
   *
   * @example
   * await db.export('users', './backup/users.json');
   * await db.export('users', './backup/users.csv', { format: 'csv' });
   */
  async export<T extends Record<string, unknown>>(
    collectionName: string,
    filePath: string,
    options?: ExportOptions
  ): Promise<number> {
    await this.init();
    const col = this.collection<T>(collectionName);
    return exportToFile(col, filePath, options);
  }

  // ─── Health & Diagnostics ─────────────────────────────────────────────

  /**
   * Check connection health and rate limit status.
   *
   * @example
   * const health = await db.health();
   * console.log(health.connected, health.rateLimit.remaining);
   */
  async health(): Promise<HealthStatus> {
    try {
      const rateLimit = await this.github.getRateLimit();
      return {
        connected: true,
        repo: this.config.repo,
        owner: this.config.owner,
        branch: this.config.branch,
        rateLimit,
      };
    } catch {
      return {
        connected: false,
        repo: this.config.repo,
        owner: this.config.owner,
        branch: this.config.branch,
        rateLimit: { limit: 0, remaining: 0, used: 0, resetsAt: '' },
      };
    }
  }

  /**
   * Get current rate limit status.
   */
  async rateLimit(): Promise<GitHubRateLimit> {
    return this.github.getRateLimit();
  }

  /**
   * Clear all caches. Useful if data was modified outside of GaaS.
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.cache('CLEAR', '*');
  }

  /**
   * Get info about the current configuration (safe to log, no token exposed).
   */
  info(): { repo: string; owner: string; branch: string; encryption: boolean; debug: boolean } {
    return {
      repo: this.config.repo,
      owner: this.config.owner,
      branch: this.config.branch,
      encryption: this.config.encryption.enabled,
      debug: this.config.debug,
    };
  }

  // ─── Config Resolution ────────────────────────────────────────────────

  private resolveConfig(config: GaaSConfig): ResolvedConfig {
    const token = config.token || process.env.GAAS_TOKEN || process.env.GITHUB_TOKEN;
    const repo = config.repo || process.env.GAAS_REPO;
    const owner = config.owner || process.env.GAAS_OWNER;
    const branch = config.branch || process.env.GAAS_BRANCH || 'main';

    if (!token) {
      throw new ConfigError(
        'GitHub token is required. Pass it via config ({ token: "..." }) or set the GAAS_TOKEN environment variable.'
      );
    }

    if (!repo) {
      throw new ConfigError(
        'Repository name is required. Pass it via config ({ repo: "..." }) or set the GAAS_REPO environment variable.'
      );
    }

    if (!owner) {
      throw new ConfigError(
        'Repository owner is required. Pass it via config ({ owner: "..." }) or set the GAAS_OWNER environment variable.'
      );
    }

    const encryptionKey = config.encryption?.key || process.env.GAAS_ENCRYPTION_KEY || null;

    return {
      token,
      repo,
      owner,
      branch,
      debug: config.debug ?? false,
      retry: {
        enabled: config.retry?.enabled ?? true,
        maxRetries: config.retry?.maxRetries ?? 3,
        backoff: config.retry?.backoff ?? 'exponential',
        baseDelay: config.retry?.baseDelay ?? 1000,
      },
      encryption: {
        enabled: config.encryption?.enabled ?? false,
        key: encryptionKey,
      },
    };
  }

  /** Trigger init lazily — does not await. The actual await happens inside each module method. */
  private triggerInit(): void {
    if (!this.initialized && !this.initPromise) {
      this.initPromise = this.init();
    }
  }
}
