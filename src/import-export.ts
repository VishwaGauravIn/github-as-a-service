// ─── Import/Export ───────────────────────────────────────────────────────────
//
// Bulk import from JSON/CSV and export to JSON/CSV for collections.

import { Collection } from './collection.js';
import { Logger } from './logger.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import type { ImportOptions, ExportOptions, ImportExportFormat, QueryOptions } from './types.js';
import { applyQuery } from './query.js';

// ─── CSV Parser (zero dependencies) ────────────────────────────────────────

function parseCSV(csvString: string): Record<string, unknown>[] {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const records: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const record: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      const raw = values[j] ?? '';
      record[headers[j]] = parseCSVValue(raw);
    }
    records.push(record);
  }

  return records;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSVValue(value: string): unknown {
  if (value === '' || value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;
  return value;
}

function toCSV(records: Record<string, unknown>[]): string {
  if (records.length === 0) return '';

  // Collect all unique keys
  const keys = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      keys.add(key);
    }
  }
  const headers = Array.from(keys);

  const lines: string[] = [headers.join(',')];

  for (const record of records) {
    const values = headers.map((key) => {
      const val = record[key];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Quote if contains comma, quote, or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

// ─── Import Function ────────────────────────────────────────────────────────

/**
 * Import records from a local JSON or CSV file into a collection.
 */
export async function importFromFile<T extends Record<string, unknown>>(
  collection: Collection<T>,
  filePath: string,
  options: ImportOptions = {}
): Promise<number> {
  const format = options.format || detectFormat(filePath);
  const idField = options.idField || 'id';

  // Read the file
  const content = readFileSync(filePath, 'utf-8');

  let records: Record<string, unknown>[];
  if (format === 'csv') {
    records = parseCSV(content);
  } else {
    const parsed = JSON.parse(content);
    records = Array.isArray(parsed) ? parsed : [parsed];
  }

  // Clear existing records if requested
  if (options.clear) {
    await collection.clear();
  }

  // Ensure each record has an id field
  for (const record of records) {
    if (!record.id && record[idField]) {
      record.id = record[idField];
    }
  }

  // Use batch create
  const created = await collection.createMany(records as T[]);
  return created.length;
}

/**
 * Export collection records to a local JSON or CSV file.
 */
export async function exportToFile<T extends Record<string, unknown>>(
  collection: Collection<T>,
  filePath: string,
  options: ExportOptions = {}
): Promise<number> {
  const format = options.format || detectFormat(filePath);

  // Get records
  let records = await collection.findAll();

  // Apply where filter if provided
  if (options.where) {
    records = applyQuery(records, { where: options.where } as QueryOptions<T>);
  }

  // Serialize
  let content: string;
  if (format === 'csv') {
    content = toCSV(records);
  } else {
    content = JSON.stringify(records, null, 2);
  }

  // Ensure directory exists
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });

  // Write file
  writeFileSync(filePath, content, 'utf-8');
  return records.length;
}

function detectFormat(filePath: string): ImportExportFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.csv') return 'csv';
  return 'json';
}
