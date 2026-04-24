// ─── Query Engine ───────────────────────────────────────────────────────────
//
// In-memory filtering, sorting, and pagination for collection records.
// Applied client-side after fetching data from GitHub.

import type { QueryOptions, WhereClause, WhereOperator, SortClause } from './types.js';

/**
 * Apply query options (where, sort, limit, offset) to an array of records.
 */
export function applyQuery<T extends Record<string, unknown>>(
  records: T[],
  options: QueryOptions<T>
): T[] {
  let result = [...records];

  // Apply WHERE filters
  if (options.where) {
    result = result.filter((record) => matchesWhere(record, options.where!));
  }

  // Apply SORT
  if (options.sort) {
    result = applySorting(result, options.sort);
  }

  // Apply OFFSET
  if (options.offset && options.offset > 0) {
    result = result.slice(options.offset);
  }

  // Apply LIMIT
  if (options.limit && options.limit > 0) {
    result = result.slice(0, options.limit);
  }

  return result;
}

/**
 * Count records matching a where clause.
 */
export function countMatching<T extends Record<string, unknown>>(
  records: T[],
  where?: WhereClause<T>
): number {
  if (!where) return records.length;
  return records.filter((record) => matchesWhere(record, where)).length;
}

// ─── Where Matching ─────────────────────────────────────────────────────────

function matchesWhere<T extends Record<string, unknown>>(
  record: T,
  where: WhereClause<T>
): boolean {
  for (const [field, condition] of Object.entries(where)) {
    const value = record[field];

    // If condition is a primitive, treat as $eq
    if (condition === null || condition === undefined || typeof condition !== 'object' || Array.isArray(condition)) {
      if (value !== condition) return false;
      continue;
    }

    // Operator-based matching
    const ops = condition as WhereOperator;
    if (!matchesOperators(value, ops)) return false;
  }
  return true;
}

function matchesOperators(value: unknown, ops: WhereOperator): boolean {
  if (ops.$eq !== undefined && value !== ops.$eq) return false;
  if (ops.$ne !== undefined && value === ops.$ne) return false;

  if (ops.$gt !== undefined && !(typeof value === typeof ops.$gt && (value as number) > (ops.$gt as number))) return false;
  if (ops.$gte !== undefined && !(typeof value === typeof ops.$gte && (value as number) >= (ops.$gte as number))) return false;
  if (ops.$lt !== undefined && !(typeof value === typeof ops.$lt && (value as number) < (ops.$lt as number))) return false;
  if (ops.$lte !== undefined && !(typeof value === typeof ops.$lte && (value as number) <= (ops.$lte as number))) return false;

  if (ops.$in !== undefined && !ops.$in.includes(value)) return false;
  if (ops.$nin !== undefined && ops.$nin.includes(value)) return false;

  if (ops.$contains !== undefined && !(typeof value === 'string' && value.includes(ops.$contains))) return false;
  if (ops.$startsWith !== undefined && !(typeof value === 'string' && value.startsWith(ops.$startsWith))) return false;
  if (ops.$endsWith !== undefined && !(typeof value === 'string' && value.endsWith(ops.$endsWith))) return false;

  if (ops.$exists !== undefined) {
    const exists = value !== undefined && value !== null;
    if (ops.$exists !== exists) return false;
  }

  return true;
}

// ─── Sorting ────────────────────────────────────────────────────────────────

function applySorting<T extends Record<string, unknown>>(
  records: T[],
  sort: SortClause<T>
): T[] {
  const sortFields = Object.entries(sort) as [string, 'asc' | 'desc'][];

  return records.sort((a, b) => {
    for (const [field, direction] of sortFields) {
      const aVal = a[field];
      const bVal = b[field];

      if (aVal === bVal) continue;
      if (aVal === undefined || aVal === null) return direction === 'asc' ? 1 : -1;
      if (bVal === undefined || bVal === null) return direction === 'asc' ? -1 : 1;

      const cmp = aVal < bVal ? -1 : 1;
      return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}
