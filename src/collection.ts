// ─── Collection ─────────────────────────────────────────────────────────────
//
// Firebase/MongoDB-style collection backed by JSON files in a GitHub repo.
// Each record is stored as an individual JSON file: collections/{name}/{id}.json

import { GitHubClient, type BatchOperation } from './github-client.js';
import { Encryption } from './encryption.js';
import { Logger } from './logger.js';
import { Cache } from './cache.js';
import { NotFoundError, ValidationError } from './errors.js';
import { validateData, type FieldBuilder } from './schema.js';
import { applyQuery, countMatching } from './query.js';
import type {
  CollectionOptions,
  CollectionHooks,
  QueryOptions,
  WhereClause,
  SchemaDefinition,
} from './types.js';
import { randomUUID } from 'node:crypto';

export class Collection<T extends Record<string, unknown> = Record<string, unknown>> {
  private name: string;
  private basePath: string;
  private github: GitHubClient;
  private encryption: Encryption | null;
  private logger: Logger;
  private cache: Cache;
  private schema: Record<string, FieldBuilder> | SchemaDefinition | null;
  private hooks: CollectionHooks<T>;

  constructor(
    name: string,
    github: GitHubClient,
    encryption: Encryption | null,
    logger: Logger,
    cache: Cache,
    options?: CollectionOptions<T>
  ) {
    this.name = name;
    this.basePath = `collections/${name}`;
    this.github = github;
    this.encryption = encryption;
    this.logger = logger;
    this.cache = cache;
    this.schema = (options?.schema as Record<string, FieldBuilder> | SchemaDefinition) ?? null;
    this.hooks = options?.hooks ?? {};
  }

  // ─── Create ───────────────────────────────────────────────────────────

  /** Create a single record. Auto-generates an ID if not provided. */
  async create(data: T): Promise<T> {
    let record = { ...data };

    // Generate ID if missing
    if (!record.id) {
      (record as Record<string, unknown>).id = randomUUID().split('-')[0];
    }

    // Validate
    if (this.schema) {
      record = validateData(record, this.schema) as T;
    }

    // Hook: beforeCreate
    if (this.hooks.beforeCreate) {
      record = await this.hooks.beforeCreate(record);
    }

    const id = String(record.id);
    const path = `${this.basePath}/${id}.json`;
    let content = JSON.stringify(record, null, 2);

    if (this.encryption) {
      content = this.encryption.encrypt(content);
    }

    await this.github.putFile(path, content, `[gaas] create ${this.name}/${id}`);

    // Hook: afterCreate
    if (this.hooks.afterCreate) {
      await this.hooks.afterCreate(record);
    }

    this.logger.info(`Created ${this.name}/${id}`);
    return record;
  }

  /** Create multiple records in a single commit. */
  async createMany(items: T[]): Promise<T[]> {
    const operations: BatchOperation[] = [];
    const results: T[] = [];

    for (let data of items) {
      let record = { ...data };

      if (!record.id) {
        (record as Record<string, unknown>).id = randomUUID().split('-')[0];
      }

      if (this.schema) {
        record = validateData(record, this.schema) as T;
      }

      if (this.hooks.beforeCreate) {
        record = await this.hooks.beforeCreate(record);
      }

      const id = String(record.id);
      let content = JSON.stringify(record, null, 2);

      if (this.encryption) {
        content = this.encryption.encrypt(content);
      }

      operations.push({
        type: 'create',
        path: `${this.basePath}/${id}.json`,
        content,
      });

      results.push(record);
    }

    await this.github.batchCommit(operations, `[gaas] create ${items.length} records in ${this.name}`);

    // afterCreate hooks
    for (const record of results) {
      if (this.hooks.afterCreate) {
        await this.hooks.afterCreate(record);
      }
    }

    this.logger.info(`Created ${items.length} records in ${this.name}`);
    return results;
  }

  // ─── Read ─────────────────────────────────────────────────────────────

  /** Find a single record by ID. */
  async findById(id: string): Promise<T | null> {
    const path = `${this.basePath}/${id}.json`;
    const file = await this.github.getFile(path);

    if (!file) return null;

    let content = file.content;
    if (this.encryption) {
      content = this.encryption.decrypt(content);
    }

    return JSON.parse(content) as T;
  }

  /**
   * Find records matching query options.
   *
   * @example
   * await users.find({ where: { plan: 'pro' }, sort: { name: 'asc' }, limit: 10 })
   */
  async find(options?: QueryOptions<T>): Promise<T[]> {
    const records = await this.findAll();

    if (!options) return records;
    return applyQuery(records, options);
  }

  /** Find the first record matching a where clause. */
  async findOne(where: WhereClause<T>): Promise<T | null> {
    const results = await this.find({ where, limit: 1 });
    return results[0] || null;
  }

  /** Get all records in the collection. */
  async findAll(): Promise<T[]> {
    // Use recursive tree API to avoid N+1 problem
    // Instead of: 1 listDir + N getFile = N+1 calls
    // Now:        1 getTree  + N_uncached getBlob calls (cached = 0 calls)
    const treeEntries = await this.github.getTreeContents(this.basePath);

    const records: T[] = [];
    for (const entry of treeEntries) {
      const cacheKey = `file:${entry.path}`;
      const cached = this.cache.get<string>(cacheKey);

      let content: string;
      if (cached && cached.fresh) {
        content = cached.data;
        this.logger.cache('HIT', cacheKey);
      } else {
        content = await this.github.getBlob(entry.sha);
        this.cache.set(cacheKey, content, entry.sha);
        this.logger.cache('SET', cacheKey);
      }

      if (this.encryption) {
        content = this.encryption.decrypt(content);
      }
      records.push(JSON.parse(content) as T);
    }

    return records;
  }

  /** Count records, optionally matching a where clause. */
  async count(options?: { where?: WhereClause<T> }): Promise<number> {
    const records = await this.findAll();
    return countMatching(records, options?.where);
  }

  /** Check if a record exists. */
  async exists(id: string): Promise<boolean> {
    const record = await this.findById(id);
    return record !== null;
  }

  // ─── Update ───────────────────────────────────────────────────────────

  /** Update a single record by ID (partial update / merge). */
  async update(id: string, changes: Partial<T>): Promise<T> {
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError(`${this.name}/${id}`);

    let resolvedChanges = { ...changes };

    // Hook: beforeUpdate
    if (this.hooks.beforeUpdate) {
      resolvedChanges = await this.hooks.beforeUpdate(id, resolvedChanges);
    }

    const updated = { ...existing, ...resolvedChanges } as T;

    // Validate merged record
    if (this.schema) {
      validateData(updated, this.schema);
    }

    const path = `${this.basePath}/${id}.json`;
    let content = JSON.stringify(updated, null, 2);

    if (this.encryption) {
      content = this.encryption.encrypt(content);
    }

    await this.github.putFile(path, content, `[gaas] update ${this.name}/${id}`);

    // Hook: afterUpdate
    if (this.hooks.afterUpdate) {
      await this.hooks.afterUpdate(updated);
    }

    this.logger.info(`Updated ${this.name}/${id}`);
    return updated;
  }

  /** Update multiple records in a single commit. */
  async updateMany(updates: { id: string; changes: Partial<T> }[]): Promise<T[]> {
    const operations: BatchOperation[] = [];
    const results: T[] = [];

    for (const { id, changes } of updates) {
      const existing = await this.findById(id);
      if (!existing) throw new NotFoundError(`${this.name}/${id}`);

      let resolvedChanges = { ...changes };

      if (this.hooks.beforeUpdate) {
        resolvedChanges = await this.hooks.beforeUpdate(id, resolvedChanges);
      }

      const updated = { ...existing, ...resolvedChanges } as T;

      if (this.schema) {
        validateData(updated, this.schema);
      }

      let content = JSON.stringify(updated, null, 2);
      if (this.encryption) {
        content = this.encryption.encrypt(content);
      }

      operations.push({
        type: 'update',
        path: `${this.basePath}/${id}.json`,
        content,
      });

      results.push(updated);
    }

    await this.github.batchCommit(operations, `[gaas] update ${updates.length} records in ${this.name}`);

    for (const record of results) {
      if (this.hooks.afterUpdate) {
        await this.hooks.afterUpdate(record);
      }
    }

    this.logger.info(`Updated ${updates.length} records in ${this.name}`);
    return results;
  }

  /** Replace a record entirely (full overwrite, not merge). */
  async replace(id: string, data: T): Promise<T> {
    let record = { ...data, id } as T;

    if (this.schema) {
      record = validateData(record, this.schema) as T;
    }

    const path = `${this.basePath}/${id}.json`;
    let content = JSON.stringify(record, null, 2);

    if (this.encryption) {
      content = this.encryption.encrypt(content);
    }

    await this.github.putFile(path, content, `[gaas] replace ${this.name}/${id}`);

    this.logger.info(`Replaced ${this.name}/${id}`);
    return record;
  }

  // ─── Delete ───────────────────────────────────────────────────────────

  /** Delete a single record by ID. */
  async delete(id: string): Promise<void> {
    // Hook: beforeDelete
    if (this.hooks.beforeDelete) {
      await this.hooks.beforeDelete(id);
    }

    const path = `${this.basePath}/${id}.json`;
    await this.github.deleteFile(path, `[gaas] delete ${this.name}/${id}`);

    // Hook: afterDelete
    if (this.hooks.afterDelete) {
      await this.hooks.afterDelete(id);
    }

    this.logger.info(`Deleted ${this.name}/${id}`);
  }

  /** Delete multiple records in a single commit. */
  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (this.hooks.beforeDelete) {
        await this.hooks.beforeDelete(id);
      }
    }

    const operations: BatchOperation[] = ids.map((id) => ({
      type: 'delete' as const,
      path: `${this.basePath}/${id}.json`,
      content: '',
    }));

    await this.github.batchCommit(operations, `[gaas] delete ${ids.length} records from ${this.name}`);

    for (const id of ids) {
      if (this.hooks.afterDelete) {
        await this.hooks.afterDelete(id);
      }
    }

    this.logger.info(`Deleted ${ids.length} records from ${this.name}`);
  }

  /** Delete all records in the collection. */
  async clear(): Promise<void> {
    // Invalidate cache to get fresh data
    this.cache.invalidatePrefix(`dir:${this.basePath}`);
    this.cache.invalidatePrefix(`file:${this.basePath}`);

    // Use tree API to list files (avoids stale cache issues)
    const treeEntries = await this.github.getTreeContents(this.basePath);

    if (treeEntries.length === 0) return;

    const operations: BatchOperation[] = treeEntries.map((entry) => ({
      type: 'delete' as const,
      path: entry.path,
      content: '',
    }));

    // Tree reconstruction: all deletes handled in a single commit (~4 API calls)
    await this.github.batchCommit(operations, `[gaas] clear collection ${this.name}`);
    this.cache.invalidatePrefix(`file:${this.basePath}`);
    this.cache.invalidatePrefix(`dir:${this.basePath}`);

    this.logger.info(`Cleared collection ${this.name} (${treeEntries.length} records)`);
  }
}

