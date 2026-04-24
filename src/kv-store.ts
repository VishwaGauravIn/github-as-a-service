// ─── Key-Value Store ────────────────────────────────────────────────────────
//
// Simple key-value store backed by a single JSON file: kv/store.json
// Perfect for config, feature flags, app state, and counters.

import { GitHubClient } from './github-client.js';
import { Encryption } from './encryption.js';
import { Logger } from './logger.js';
import { Cache } from './cache.js';

const KV_PATH = 'kv/store.json';

export class KVStore {
  private github: GitHubClient;
  private encryption: Encryption | null;
  private logger: Logger;
  private cache: Cache;

  constructor(
    github: GitHubClient,
    encryption: Encryption | null,
    logger: Logger,
    cache: Cache
  ) {
    this.github = github;
    this.encryption = encryption;
    this.logger = logger;
    this.cache = cache;
  }

  /** Get a value by key. Returns undefined if not found. */
  async get<V = unknown>(key: string): Promise<V | undefined> {
    const store = await this.loadStore();
    return store[key] as V | undefined;
  }

  /** Set a value for a key. Supports any JSON-serializable value. */
  async set(key: string, value: unknown): Promise<void> {
    const store = await this.loadStore();
    store[key] = value;
    await this.saveStore(store, `[gaas] kv set "${key}"`);
    this.logger.info(`KV set: ${key}`);
  }

  /** Delete a key. */
  async delete(key: string): Promise<boolean> {
    const store = await this.loadStore();
    if (!(key in store)) return false;
    delete store[key];
    await this.saveStore(store, `[gaas] kv delete "${key}"`);
    this.logger.info(`KV delete: ${key}`);
    return true;
  }

  /** Check if a key exists. */
  async has(key: string): Promise<boolean> {
    const store = await this.loadStore();
    return key in store;
  }

  /** Get all keys. */
  async keys(): Promise<string[]> {
    const store = await this.loadStore();
    return Object.keys(store);
  }

  /** Get all key-value pairs. */
  async getAll(): Promise<Record<string, unknown>> {
    return await this.loadStore();
  }

  /** Set multiple key-value pairs at once (single commit). */
  async setMany(entries: Record<string, unknown>): Promise<void> {
    const store = await this.loadStore();
    Object.assign(store, entries);
    await this.saveStore(store, `[gaas] kv set ${Object.keys(entries).length} keys`);
    this.logger.info(`KV set ${Object.keys(entries).length} keys`);
  }

  /** Delete multiple keys at once (single commit). */
  async deleteMany(keys: string[]): Promise<number> {
    const store = await this.loadStore();
    let deleted = 0;
    for (const key of keys) {
      if (key in store) {
        delete store[key];
        deleted++;
      }
    }
    if (deleted > 0) {
      await this.saveStore(store, `[gaas] kv delete ${deleted} keys`);
    }
    this.logger.info(`KV deleted ${deleted} keys`);
    return deleted;
  }

  /** Clear all key-value pairs. */
  async clear(): Promise<void> {
    await this.saveStore({}, '[gaas] kv clear');
    this.logger.info('KV store cleared');
  }

  /** Get the number of keys. */
  async size(): Promise<number> {
    const store = await this.loadStore();
    return Object.keys(store).length;
  }

  // ─── Utility Methods ────────────────────────────────────────────────

  /** Increment a numeric value. Creates with initial value if key doesn't exist. */
  async increment(key: string, amount: number = 1): Promise<number> {
    const store = await this.loadStore();
    const current = typeof store[key] === 'number' ? (store[key] as number) : 0;
    const newValue = current + amount;
    store[key] = newValue;
    await this.saveStore(store, `[gaas] kv increment "${key}"`);
    return newValue;
  }

  /** Toggle a boolean value. Creates with `true` if key doesn't exist. */
  async toggle(key: string): Promise<boolean> {
    const store = await this.loadStore();
    const newValue = !store[key];
    store[key] = newValue;
    await this.saveStore(store, `[gaas] kv toggle "${key}"`);
    return newValue;
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private async loadStore(): Promise<Record<string, unknown>> {
    const file = await this.github.getFile(KV_PATH);
    if (!file) return {};

    let content = file.content;
    if (this.encryption) {
      content = this.encryption.decrypt(content);
    }

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      this.logger.warn('KV store file is corrupted, starting fresh');
      return {};
    }
  }

  private async saveStore(store: Record<string, unknown>, message: string): Promise<void> {
    let content = JSON.stringify(store, null, 2);
    if (this.encryption) {
      content = this.encryption.encrypt(content);
    }
    await this.github.putFile(KV_PATH, content, message);
  }
}
