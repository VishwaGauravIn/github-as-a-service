// ─── Storage ────────────────────────────────────────────────────────────────
//
// File storage API for images, PDFs, and other binary assets.
// Files are stored under: storage/{path}

import { GitHubClient } from './github-client.js';
import { Logger } from './logger.js';
import { NotFoundError } from './errors.js';
import type { StorageFileInfo } from './types.js';
import { readFileSync, existsSync } from 'node:fs';

const STORAGE_PREFIX = 'storage';

export class Storage {
  private github: GitHubClient;
  private logger: Logger;
  private owner: string;
  private repo: string;
  private branch: string;

  constructor(
    github: GitHubClient,
    logger: Logger,
    owner: string,
    repo: string,
    branch: string
  ) {
    this.github = github;
    this.logger = logger;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
  }

  /**
   * Upload a file. Accepts a local file path, Buffer, or string content.
   *
   * @example
   * await storage.upload('avatars/user.png', './local-image.png');
   * await storage.upload('data/report.txt', 'Hello World');
   * await storage.upload('docs/spec.pdf', pdfBuffer);
   */
  async upload(storagePath: string, content: string | Buffer): Promise<StorageFileInfo> {
    const fullPath = `${STORAGE_PREFIX}/${storagePath}`;

    let buffer: Buffer;
    if (typeof content === 'string') {
      // Check if it's a file path
      if (existsSync(content)) {
        buffer = readFileSync(content);
      } else {
        buffer = Buffer.from(content, 'utf-8');
      }
    } else {
      buffer = content;
    }

    const sha = await this.github.putBinaryFile(
      fullPath,
      buffer,
      `[gaas] upload ${storagePath}`
    );

    this.logger.info(`Uploaded: ${storagePath} (${buffer.length} bytes)`);

    return {
      name: storagePath.split('/').pop() || storagePath,
      path: storagePath,
      size: buffer.length,
      sha,
      downloadUrl: this.buildDownloadUrl(fullPath),
      type: 'file',
    };
  }

  /**
   * Download a file as a Buffer.
   */
  async download(storagePath: string): Promise<Buffer> {
    const fullPath = `${STORAGE_PREFIX}/${storagePath}`;
    const file = await this.github.getBinaryFile(fullPath);

    if (!file) {
      throw new NotFoundError(`storage/${storagePath}`);
    }

    return file.content;
  }

  /**
   * Get the raw GitHub URL for a file (works for public repos).
   * For private repos, use download() to fetch the content.
   */
  getUrl(storagePath: string): string {
    return this.buildDownloadUrl(`${STORAGE_PREFIX}/${storagePath}`);
  }

  /**
   * List files in a storage directory.
   */
  async list(directory?: string): Promise<StorageFileInfo[]> {
    const fullPath = directory
      ? `${STORAGE_PREFIX}/${directory}`
      : STORAGE_PREFIX;

    const entries = await this.github.listDirectory(fullPath);

    return entries.map((entry) => ({
      name: entry.name,
      path: entry.path.replace(`${STORAGE_PREFIX}/`, ''),
      size: entry.size,
      sha: entry.sha,
      downloadUrl: entry.download_url,
      type: entry.type as 'file' | 'dir',
    }));
  }

  /**
   * Check if a file exists in storage.
   * Uses directory listing (cheap) instead of downloading the full file.
   */
  async exists(storagePath: string): Promise<boolean> {
    const fullPath = `${STORAGE_PREFIX}/${storagePath}`;
    const parentDir = fullPath.split('/').slice(0, -1).join('/');
    const fileName = fullPath.split('/').pop();

    try {
      const entries = await this.github.listDirectory(parentDir);
      return entries.some((e) => e.name === fileName);
    } catch {
      return false;
    }
  }

  /**
   * Delete a file from storage.
   */
  async delete(storagePath: string): Promise<void> {
    const fullPath = `${STORAGE_PREFIX}/${storagePath}`;
    await this.github.deleteFile(fullPath, `[gaas] delete ${storagePath}`);
    this.logger.info(`Deleted: ${storagePath}`);
  }

  /**
   * Get file info (metadata) without downloading content.
   */
  async info(storagePath: string): Promise<StorageFileInfo | null> {
    const fullPath = `${STORAGE_PREFIX}/${storagePath}`;
    const entries = await this.github.listDirectory(
      fullPath.split('/').slice(0, -1).join('/')
    );
    const fileName = fullPath.split('/').pop();
    const entry = entries.find((e) => e.name === fileName);

    if (!entry) return null;

    return {
      name: entry.name,
      path: storagePath,
      size: entry.size,
      sha: entry.sha,
      downloadUrl: entry.download_url,
      type: entry.type as 'file' | 'dir',
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────

  private buildDownloadUrl(path: string): string {
    return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.branch}/${path}`;
  }
}
