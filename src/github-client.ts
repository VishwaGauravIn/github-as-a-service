// ─── GitHub Client ──────────────────────────────────────────────────────────
//
// Wraps @octokit/rest with: retry logic, rate limit tracking, SHA management,
// batch commits via Git Trees API, and debug logging.

import { Octokit } from '@octokit/rest';
import { Cache } from './cache.js';
import { Logger } from './logger.js';
import {
  AuthenticationError,
  RateLimitError,
  ConflictError,
  NotFoundError,
  GitHubApiError,
  GaaSError,
} from './errors.js';
import type { ResolvedConfig, GitHubFileContent, GitHubRateLimit } from './types.js';

export class GitHubClient {
  private octokit: Octokit;
  private config: ResolvedConfig;
  private cache: Cache;
  private logger: Logger;

  constructor(config: ResolvedConfig, cache: Cache, logger: Logger) {
    this.config = config;
    this.cache = cache;
    this.logger = logger;
    this.octokit = new Octokit({ auth: config.token });
  }

  // ─── Repository Management ──────────────────────────────────────────────

  /** Ensure the target repo exists, create it if not. */
  async ensureRepo(): Promise<void> {
    try {
      await this.octokit.repos.get({
        owner: this.config.owner,
        repo: this.config.repo,
      });
      this.logger.info(`Repository "${this.config.owner}/${this.config.repo}" exists`);
    } catch (err: unknown) {
      const error = err as { status?: number };
      if (error.status === 404) {
        this.logger.info(`Creating repository "${this.config.repo}"...`);
        await this.octokit.repos.createForAuthenticatedUser({
          name: this.config.repo,
          private: true,
          auto_init: true,
          description: 'GaaS data repository — managed by github-as-a-service',
        });
        this.logger.info(`Repository "${this.config.repo}" created`);
      } else if (error.status === 401 || error.status === 403) {
        throw new AuthenticationError();
      } else {
        throw this.wrapError(err);
      }
    }
  }

  /** Ensure a branch exists, create it from the default branch if not. */
  async ensureBranch(): Promise<void> {
    if (this.config.branch === 'main') return; // main always exists after auto_init

    try {
      await this.octokit.repos.getBranch({
        owner: this.config.owner,
        repo: this.config.repo,
        branch: this.config.branch,
      });
    } catch (err: unknown) {
      const error = err as { status?: number };
      if (error.status === 404) {
        // Get main branch SHA and create new branch from it
        const { data: mainRef } = await this.octokit.git.getRef({
          owner: this.config.owner,
          repo: this.config.repo,
          ref: 'heads/main',
        });
        await this.octokit.git.createRef({
          owner: this.config.owner,
          repo: this.config.repo,
          ref: `refs/heads/${this.config.branch}`,
          sha: mainRef.object.sha,
        });
        this.logger.info(`Branch "${this.config.branch}" created`);
      } else {
        throw this.wrapError(err);
      }
    }
  }

  // ─── File Operations ────────────────────────────────────────────────────

  /** Get file content from the repo. Returns parsed content + SHA. */
  async getFile(path: string): Promise<{ content: string; sha: string } | null> {
    const cacheKey = `file:${path}`;
    const cached = this.cache.get<string>(cacheKey);

    if (cached && cached.fresh) {
      this.logger.cache('HIT', cacheKey);
      return { content: cached.data, sha: cached.sha };
    }

    const start = Date.now();
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        ref: this.config.branch,
      });

      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }

      const fileData = data as GitHubFileContent;
      const content = Buffer.from(fileData.content || '', 'base64').toString('utf-8');

      this.cache.set(cacheKey, content, fileData.sha);
      this.logger.cache('SET', cacheKey);
      this.logger.api('GET', path, 'cache MISS', Date.now() - start);

      return { content, sha: fileData.sha };
    } catch (err: unknown) {
      const error = err as { status?: number };
      if (error.status === 404) {
        this.logger.api('GET', path, '404 Not Found', Date.now() - start);
        return null;
      }
      throw this.wrapError(err);
    }
  }

  /** Get binary file content from the repo. Returns Buffer + SHA. */
  async getBinaryFile(path: string): Promise<{ content: Buffer; sha: string } | null> {
    const start = Date.now();
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        ref: this.config.branch,
      });

      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }

      const fileData = data as GitHubFileContent;
      const content = Buffer.from(fileData.content || '', 'base64');

      this.logger.api('GET', path, 'binary', Date.now() - start);
      return { content, sha: fileData.sha };
    } catch (err: unknown) {
      const error = err as { status?: number };
      if (error.status === 404) return null;
      throw this.wrapError(err);
    }
  }

  /** Create or update a single file. */
  async putFile(path: string, content: string, message: string, sha?: string): Promise<string> {
    const start = Date.now();

    // If no SHA provided, try to get it from cache or fetch it
    if (!sha) {
      sha = this.cache.getSha(`file:${path}`) ?? undefined;
      if (!sha) {
        const existing = await this.getFile(path);
        sha = existing?.sha;
      }
    }

    const result = await this.withRetry(async () => {
      const { data } = await this.octokit.repos.createOrUpdateFileContents({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
        branch: this.config.branch,
        ...(sha ? { sha } : {}),
      });
      return data;
    }, path);

    const newSha = result.content?.sha || '';
    this.cache.set(`file:${path}`, content, newSha);
    this.logger.api('PUT', path, `SHA: ${newSha.slice(0, 7)}`, Date.now() - start);

    return newSha;
  }

  /** Put a binary file. */
  async putBinaryFile(path: string, content: Buffer, message: string, sha?: string): Promise<string> {
    const start = Date.now();

    if (!sha) {
      sha = this.cache.getSha(`file:${path}`) ?? undefined;
      if (!sha) {
        const existing = await this.getBinaryFile(path);
        sha = existing?.sha;
      }
    }

    const result = await this.withRetry(async () => {
      const { data } = await this.octokit.repos.createOrUpdateFileContents({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        message,
        content: content.toString('base64'),
        branch: this.config.branch,
        ...(sha ? { sha } : {}),
      });
      return data;
    }, path);

    const newSha = result.content?.sha || '';
    this.logger.api('PUT', path, `binary, SHA: ${newSha.slice(0, 7)}`, Date.now() - start);
    return newSha;
  }

  /** Delete a single file. */
  async deleteFile(path: string, message: string, sha?: string): Promise<void> {
    const start = Date.now();

    if (!sha) {
      sha = this.cache.getSha(`file:${path}`) ?? undefined;
      if (!sha) {
        const existing = await this.getFile(path);
        if (!existing) throw new NotFoundError(path);
        sha = existing.sha;
      }
    }

    await this.withRetry(async () => {
      await this.octokit.repos.deleteFile({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        message,
        sha: sha!,
        branch: this.config.branch,
      });
    }, path);

    this.cache.invalidate(`file:${path}`);
    this.logger.api('DELETE', path, undefined, Date.now() - start);
  }

  /** List files/dirs in a directory. */
  async listDirectory(path: string): Promise<GitHubFileContent[]> {
    const cacheKey = `dir:${path}`;
    const cached = this.cache.get<GitHubFileContent[]>(cacheKey);

    if (cached && cached.fresh) {
      this.logger.cache('HIT', cacheKey);
      return cached.data;
    }

    const start = Date.now();
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.config.owner,
        repo: this.config.repo,
        path,
        ref: this.config.branch,
      });

      if (!Array.isArray(data)) {
        return [];
      }

      const entries = data as GitHubFileContent[];
      this.cache.set(cacheKey, entries, '', 30_000); // 30s TTL for dirs
      this.logger.api('LIST', path, `${entries.length} items`, Date.now() - start);
      return entries;
    } catch (err: unknown) {
      const error = err as { status?: number };
      if (error.status === 404) return [];
      throw this.wrapError(err);
    }
  }

  // ─── Batch Operations (Git Trees API) ───────────────────────────────────

  /**
   * Create, update, or delete multiple files in a single commit.
   * This uses the low-level Git Trees API to stay efficient on rate limits.
   */
  async batchCommit(
    operations: BatchOperation[],
    message: string
  ): Promise<void> {
    if (operations.length === 0) return;

    const start = Date.now();

    // 1. Get the latest commit SHA for the branch
    const { data: refData } = await this.octokit.git.getRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${this.config.branch}`,
    });
    const latestCommitSha = refData.object.sha;

    // 2. Get the tree SHA from that commit
    const { data: commitData } = await this.octokit.git.getCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitData.tree.sha;

    // 3. Build tree entries
    const treeEntries: TreeEntry[] = [];

    for (const op of operations) {
      if (op.type === 'delete') {
        treeEntries.push({
          path: op.path,
          mode: '100644',
          type: 'blob',
          sha: null, // null SHA = delete
        });
      } else {
        // Create a blob for each file
        const { data: blob } = await this.octokit.git.createBlob({
          owner: this.config.owner,
          repo: this.config.repo,
          content: op.binary
            ? op.content.toString('base64')
            : Buffer.from(op.content as string).toString('base64'),
          encoding: 'base64',
        });
        treeEntries.push({
          path: op.path,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        });
      }
    }

    // 4. Create a new tree
    const { data: newTree } = await this.octokit.git.createTree({
      owner: this.config.owner,
      repo: this.config.repo,
      base_tree: baseTreeSha,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tree: treeEntries as any,
    });

    // 5. Create a commit pointing to the new tree
    const { data: newCommit } = await this.octokit.git.createCommit({
      owner: this.config.owner,
      repo: this.config.repo,
      message,
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    // 6. Update the branch reference
    await this.octokit.git.updateRef({
      owner: this.config.owner,
      repo: this.config.repo,
      ref: `heads/${this.config.branch}`,
      sha: newCommit.sha,
    });

    // Invalidate all affected cache entries
    for (const op of operations) {
      this.cache.invalidate(`file:${op.path}`);
      // Invalidate parent directory cache
      const dirPath = op.path.split('/').slice(0, -1).join('/');
      if (dirPath) this.cache.invalidate(`dir:${dirPath}`);
    }

    this.logger.api('BATCH', `${operations.length} files`, `commit: ${newCommit.sha.slice(0, 7)}`, Date.now() - start);
  }

  // ─── Rate Limit ─────────────────────────────────────────────────────────

  async getRateLimit(): Promise<GitHubRateLimit> {
    const { data } = await this.octokit.rateLimit.get();
    const core = data.resources.core;
    const resetsAt = new Date(core.reset * 1000).toISOString();

    this.logger.rateLimit(core.remaining, core.limit, resetsAt);

    return {
      limit: core.limit,
      remaining: core.remaining,
      used: core.used,
      resetsAt,
    };
  }

  // ─── Retry Logic ────────────────────────────────────────────────────────

  private async withRetry<T>(fn: () => Promise<T>, filePath?: string): Promise<T> {
    const { enabled, maxRetries, backoff, baseDelay } = this.config.retry;

    let lastError: unknown;
    const attempts = enabled ? maxRetries + 1 : 1;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        lastError = err;
        const error = err as { status?: number; response?: { headers?: Record<string, string>; data?: { message?: string } } };

        // Rate limit — wait and retry
        if (error.status === 403 && error.response?.headers?.['x-ratelimit-remaining'] === '0') {
          const resetTime = error.response.headers['x-ratelimit-reset'];
          const resetsAt = new Date(Number(resetTime) * 1000);
          const retryAfter = Math.ceil((resetsAt.getTime() - Date.now()) / 1000);
          throw new RateLimitError(retryAfter, resetsAt.toISOString());
        }

        // SHA conflict — refetch and retry
        if (error.status === 409 || (error.status === 422 && error.response?.data?.message?.includes('sha'))) {
          if (filePath) {
            this.cache.invalidate(`file:${filePath}`);
            this.logger.warn(`Conflict on "${filePath}", retrying (attempt ${attempt + 1}/${attempts})...`);
          }
          if (attempt < attempts - 1) {
            await this.delay(this.getBackoffDelay(attempt, backoff, baseDelay));
            continue;
          }
          throw new ConflictError(filePath || 'unknown');
        }

        // Auth error — don't retry
        if (error.status === 401 || error.status === 403) {
          throw new AuthenticationError();
        }

        // Other errors — retry with backoff
        if (attempt < attempts - 1) {
          this.logger.warn(`Request failed (attempt ${attempt + 1}/${attempts}), retrying...`);
          await this.delay(this.getBackoffDelay(attempt, backoff, baseDelay));
          continue;
        }
      }
    }

    throw this.wrapError(lastError);
  }

  private getBackoffDelay(attempt: number, strategy: string, baseDelay: number): number {
    switch (strategy) {
      case 'exponential':
        return baseDelay * Math.pow(2, attempt);
      case 'linear':
        return baseDelay * (attempt + 1);
      case 'fixed':
      default:
        return baseDelay;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Error Wrapping ─────────────────────────────────────────────────────

  private wrapError(err: unknown): GaaSError {
    const error = err as { status?: number; message?: string };
    if (error.status) {
      return new GitHubApiError(error.message || 'GitHub API error', error.status);
    }
    return new GitHubApiError(String(err), 500);
  }
}



export interface BatchOperation {
  type: 'create' | 'update' | 'delete';
  path: string;
  content: string | Buffer;
  binary?: boolean;
}

interface TreeEntry {
  path: string;
  mode: '100644';
  type: 'blob';
  sha: string | null;
}
