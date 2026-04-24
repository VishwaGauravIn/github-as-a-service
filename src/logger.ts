// ─── Debug Logger ───────────────────────────────────────────────────────────
//
// Lightweight logger that only outputs when debug mode is enabled.
// Format: [GaaS] METHOD /path (details, timing)

export class Logger {
  private enabled: boolean;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  /** Log a GitHub API call */
  api(method: string, path: string, details?: string, durationMs?: number): void {
    if (!this.enabled) return;
    const parts = [`[GaaS] ${method} ${path}`];
    if (details) parts.push(`(${details})`);
    if (durationMs !== undefined) parts.push(`${durationMs}ms`);
    console.log(parts.join(' '));
  }

  /** Log a cache event */
  cache(action: 'HIT' | 'MISS' | 'SET' | 'INVALIDATE' | 'CLEAR', key: string): void {
    if (!this.enabled) return;
    console.log(`[GaaS] Cache ${action}: ${key}`);
  }

  /** Log rate limit info */
  rateLimit(remaining: number, limit: number, resetsIn: string): void {
    if (!this.enabled) return;
    console.log(`[GaaS] Rate limit: ${remaining}/${limit} remaining (resets ${resetsIn})`);
  }

  /** Log general info */
  info(message: string): void {
    if (!this.enabled) return;
    console.log(`[GaaS] ${message}`);
  }

  /** Log warnings (always shown) */
  warn(message: string): void {
    console.warn(`[GaaS] ⚠️  ${message}`);
  }

  /** Log errors (always shown) */
  error(message: string, err?: unknown): void {
    console.error(`[GaaS] ❌ ${message}`);
    if (err && this.enabled) {
      console.error(err);
    }
  }
}
