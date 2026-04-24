# GaaS — GitHub as a Service

> Turn any GitHub repository into a zero-cost, version-controlled database.

[![npm](https://img.shields.io/npm/v/github-as-a-service)](https://www.npmjs.com/package/github-as-a-service)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

GaaS is an NPM package that turns any GitHub private (or public) repository into a lightweight database — with **collections**, **key-value store**, **file storage**, **schema validation**, **encryption**, and more. Perfect for MVPs, side projects, hackathons, and internal tools.

**Zero cost. Zero infrastructure. Your data, your repo.**

<img width="1536" height="1024" alt="gaas-thumb" src="https://github.com/user-attachments/assets/a8aacbeb-75a0-4a5e-9ad0-c167460c2b3f" />


---

## Quick Start

```bash
npm install github-as-a-service
```

```typescript
import { GaaS } from 'github-as-a-service';

const db = new GaaS({
  token: 'ghp_xxxxxxxxxxxx',   // GitHub Personal Access Token
  repo: 'my-app-data',         // Auto-creates if doesn't exist
  owner: 'your-username',      // GitHub username or org
});

// Create a collection and add data
const users = db.collection('users');
await users.create({ id: 'u1', name: 'Vishwa', email: 'vishwa@example.com' });

// Read it back
const user = await users.findById('u1');
console.log(user); // { id: 'u1', name: 'Vishwa', email: 'vishwa@example.com' }
```

That's it. Your data is now stored as JSON files in a private GitHub repo with full git history.

---

## Features

| Feature | Description |
|---|---|
| **Collections** | Firebase/MongoDB-style CRUD with queries, filtering, sorting |
| **Key-Value Store** | Simple get/set for config, feature flags, counters |
| **File Storage** | Upload/download images, PDFs, binary files |
| **Schema Validation** | Built-in fluent validation (no Zod needed) |
| **Lifecycle Hooks** | beforeCreate, afterUpdate, beforeDelete, etc. |
| **Batch Operations** | Create/update/delete many records in a single commit |
| **Encryption** | AES-256-GCM encryption for sensitive data |
| **Branch Environments** | Use `branch: 'dev'` for dev data, `branch: 'main'` for prod |
| **Import/Export** | Bulk import from JSON/CSV, export to JSON/CSV |
| **Debug Mode** | See every API call, cache hit/miss, and timing |
| **Auto-retry** | Exponential backoff on failures + SHA conflict resolution |
| **TypeScript** | Full type safety with generics |

---

## Configuration

### Via constructor:
```typescript
const db = new GaaS({
  token: 'ghp_xxxxxxxxxxxx',
  repo: 'my-app-data',
  owner: 'your-username',
  branch: 'main',              // default: 'main'
  debug: false,                 // default: false
  retry: {
    enabled: true,              // default: true
    maxRetries: 3,              // default: 3
    backoff: 'exponential',     // 'exponential' | 'linear' | 'fixed'
  },
  encryption: {
    enabled: false,             // default: false
    key: 'your-secret-key',     // AES-256-GCM
  },
});
```

### Via environment variables:
```bash
# .env
GAAS_TOKEN=ghp_xxxxxxxxxxxx
GAAS_REPO=my-app-data
GAAS_OWNER=your-username
GAAS_BRANCH=main
GAAS_ENCRYPTION_KEY=your-secret-key
```

```typescript
// No config needed — reads from env vars
const db = new GaaS();
```

---

## Collections

### CRUD Operations

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'pro';
}

const users = db.collection<User>('users');

// Create
const user = await users.create({
  name: 'Alice',
  email: 'alice@example.com',
  plan: 'free',
}); // Auto-generates id

// Read
const alice = await users.findById('abc123');
const allUsers = await users.findAll();

// Update (merge)
await users.update('abc123', { plan: 'pro' });

// Replace (full overwrite)
await users.replace('abc123', { id: 'abc123', name: 'Alice Pro', email: 'alice@pro.com', plan: 'pro' });

// Delete
await users.delete('abc123');

// Check existence
const exists = await users.exists('abc123');
```

### Querying

```typescript
// Filter with where clause
const proUsers = await users.find({
  where: { plan: 'pro' },
  sort: { name: 'asc' },
  limit: 10,
  offset: 0,
});

// Find one
const admin = await users.findOne({ name: 'Admin' });

// Count
const proCount = await users.count({ where: { plan: 'pro' } });
```

### Where Operators

```typescript
await users.find({
  where: {
    age: { $gte: 18, $lt: 65 },
    plan: { $in: ['pro', 'enterprise'] },
    name: { $contains: 'alice' },
    email: { $endsWith: '@gmail.com' },
    deletedAt: { $exists: false },
  },
});
```

| Operator | Description |
|---|---|
| `$eq` | Equal to |
| `$ne` | Not equal to |
| `$gt` / `$gte` | Greater than / Greater than or equal |
| `$lt` / `$lte` | Less than / Less than or equal |
| `$in` / `$nin` | In array / Not in array |
| `$contains` | String contains |
| `$startsWith` | String starts with |
| `$endsWith` | String ends with |
| `$exists` | Field exists (not null/undefined) |

### Batch Operations

```typescript
// Create many (single commit)
await users.createMany([
  { name: 'Bob', email: 'bob@example.com', plan: 'free' },
  { name: 'Charlie', email: 'charlie@example.com', plan: 'pro' },
]);

// Update many (single commit)
await users.updateMany([
  { id: 'u1', changes: { plan: 'pro' } },
  { id: 'u2', changes: { plan: 'pro' } },
]);

// Delete many (single commit)
await users.deleteMany(['u1', 'u2', 'u3']);

// Clear all records
await users.clear();
```

### Lifecycle Hooks

```typescript
const users = db.collection('users', {
  hooks: {
    beforeCreate: (data) => {
      data.createdAt = new Date().toISOString();
      return data;
    },
    afterCreate: (record) => {
      console.log(`User created: ${record.name}`);
    },
    beforeUpdate: (id, changes) => {
      changes.updatedAt = new Date().toISOString();
      return changes;
    },
    beforeDelete: (id) => {
      console.log(`Deleting user: ${id}`);
    },
  },
});
```

### Schema Validation

```typescript
import { GaaS, Schema } from 'github-as-a-service';

const users = db.collection('users', {
  schema: {
    name: Schema.string().required().minLength(2),
    email: Schema.string().email().required(),
    age: Schema.number().min(13).optional(),
    plan: Schema.enum(['free', 'pro', 'enterprise']).default('free'),
    website: Schema.string().url().optional(),
    tags: Schema.array().optional(),
  },
});

// Throws ValidationError with detailed field-level errors
await users.create({ name: 'A', email: 'not-an-email' });
```

---

## Key-Value Store

```typescript
const kv = db.kv();

// Basic operations
await kv.set('app:version', '2.1.0');
await kv.set('feature:dark_mode', true);
await kv.set('config', { maxUsers: 100, theme: 'dark' });

const version = await kv.get('app:version');     // '2.1.0'
const exists = await kv.has('app:version');       // true
await kv.delete('app:version');

// Batch operations
await kv.setMany({ key1: 'value1', key2: 'value2' });
await kv.deleteMany(['key1', 'key2']);

// Utility methods
await kv.increment('stats:visits');               // 1, 2, 3, ...
await kv.increment('stats:visits', 5);            // +5
await kv.toggle('feature:maintenance');            // true → false → true

// Inspection
const allKeys = await kv.keys();
const allData = await kv.getAll();
const count = await kv.size();
await kv.clear();
```

---

## File Storage

```typescript
const storage = db.storage();

// Upload from file path
await storage.upload('avatars/user.png', './local-image.png');

// Upload from Buffer
await storage.upload('docs/report.pdf', someBuffer);

// Upload text content
await storage.upload('config/settings.yaml', 'key: value');

// Download
const buffer = await storage.download('avatars/user.png');

// Get URL (works for public repos)
const url = storage.getUrl('avatars/user.png');

// List files
const files = await storage.list('avatars/');

// Check existence
const exists = await storage.exists('avatars/user.png');

// Get metadata
const info = await storage.info('avatars/user.png');

// Delete
await storage.delete('avatars/user.png');
```

---

## Branch Environments

Use git branches to separate dev/staging/production data:

```typescript
// Development
const devDb = new GaaS({
  token: 'ghp_xxx',
  repo: 'my-app-data',
  owner: 'username',
  branch: 'dev',
});

// Production
const prodDb = new GaaS({
  token: 'ghp_xxx',
  repo: 'my-app-data',
  owner: 'username',
  branch: 'main',
});
```

---

## Encryption

Enable AES-256-GCM encryption to encrypt all data before writing to GitHub:

```typescript
const db = new GaaS({
  token: 'ghp_xxx',
  repo: 'my-data',
  owner: 'username',
  encryption: {
    enabled: true,
    key: process.env.GAAS_ENCRYPTION_KEY,
  },
});

// All data is now encrypted at rest in your GitHub repo
```

---

## Import / Export

```typescript
// Import from local file
const count = await db.import('users', './data/users.json');
const count2 = await db.import('contacts', './data/contacts.csv', {
  clear: true,      // clear existing records first
  idField: 'userId', // use 'userId' as the ID field
});

// Export to local file
await db.export('users', './backup/users.json');
await db.export('users', './backup/users.csv', { format: 'csv' });

// Export with filtering
await db.export('users', './pro-users.json', {
  where: { plan: 'pro' },
});
```

---

## Health & Diagnostics

```typescript
// Health check
const health = await db.health();
// {
//   connected: true,
//   repo: 'my-data',
//   owner: 'username',
//   branch: 'main',
//   rateLimit: { remaining: 4500, limit: 5000, used: 500, resetsAt: '...' }
// }

// Rate limit check
const limits = await db.rateLimit();

// Clear cache (if data was modified outside GaaS)
db.clearCache();

// Get safe config info (no token exposed)
const info = db.info();
```

---

## Error Handling

```typescript
import {
  GaaSError,
  RateLimitError,
  ConflictError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
} from 'github-as-a-service';

try {
  await users.create(data);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Rate limited. Retry after ${error.retryAfter}s`);
  }
  if (error instanceof ConflictError) {
    console.log(`Conflict on ${error.filePath}`);
  }
  if (error instanceof ValidationError) {
    error.errors.forEach(e => console.log(`${e.field}: ${e.message}`));
  }
  if (error instanceof NotFoundError) {
    console.log(`Not found: ${error.resource}`);
  }
}
```

---

## Debug Mode

```typescript
const db = new GaaS({
  token: 'ghp_xxx',
  repo: 'my-data',
  owner: 'username',
  debug: true,
});

// Console output:
// [GaaS] GaaS initialized for username/my-data (branch: main)
// [GaaS] Repository "username/my-data" exists
// [GaaS] GET collections/users/u1.json (cache MISS) 234ms
// [GaaS] Cache SET: file:collections/users/u1.json
// [GaaS] PUT collections/users/u1.json (SHA: abc1234) 456ms
// [GaaS] Rate limit: 4892/5000 remaining (resets 2026-04-25T02:00:00.000Z)
```

---

## How Data is Stored

Your GitHub repo looks like this:

```
my-app-data/
├── collections/
│   ├── users/
│   │   ├── abc123.json     ← one file per record
│   │   └── def456.json
│   └── posts/
│       └── post1.json
├── kv/
│   └── store.json          ← all key-value pairs
└── storage/
    ├── avatars/
    │   └── user.png
    └── docs/
        └── report.pdf
```

---

## API Rate Limit Optimization

GaaS aggressively minimizes GitHub API usage under the hood:

| Operation | API Calls |
|---|---|
| `create()` / `update()` | 1 |
| `findById()` | 1 (0 if cached) |
| `findAll()` (50 records) | 2 + uncached records (2 if all cached) |
| `createMany(10)` | ~14 (parallelized blob creation) |
| `deleteMany(50)` | 4 (tree reconstruction) |
| `clear()` (100 records) | 6 (tree reconstruction) |
| `storage.exists()` | 1 (dir listing, not file download) |

**How it works:**
- **Batch operations** use the Git Trees API to create/update/delete any number of files in a **single commit**
- **Deletes are free** — the tree is rebuilt without deleted paths (no per-file API calls)
- **Reads use recursive tree** — fetch all file metadata in 1 call, then only fetch content for uncached files
- **In-memory cache** with TTL tracks file content + SHA to avoid redundant reads
- **Network errors throw immediately** — never triggers retry/fallback floods that exhaust rate limits

---

## Limitations

| Limit | Detail |
|---|---|
| **Rate limit** | 5,000 GitHub API calls per hour |
| **File size** | Max 100MB per file |
| **Repo size** | Keep under 1GB |
| **Latency** | ~200-500ms per API call (cached reads are instant) |
| **Concurrency** | Use batch operations to avoid conflicts |

GaaS is perfect for **MVPs, side projects, hackathons, and internal tools**. When you outgrow it, your data is just JSON files — easy to migrate to any database.

---

## GitHub Token

Create a Personal Access Token (PAT) at [github.com/settings/tokens](https://github.com/settings/tokens):

- **Classic token**: Select the `repo` scope
- **Fine-grained token**: Grant `Contents` (Read & Write) permission

---

## Author

**VishwaGauravIn**

- [LinkedIn](https://www.linkedin.com/in/vishwagauravin/)
- [X / Twitter](https://x.com/VishwaGauravIn)
- [GitHub](https://github.com/VishwaGauravIn)

---

## License

MIT
