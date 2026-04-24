// ─── Schema Validation ──────────────────────────────────────────────────────
//
// Built-in schema validation with no external dependencies.
// Provides a fluent builder API: Schema.string().required().email()

import { ValidationError } from './errors.js';
import type { SchemaDefinition, SchemaFieldDefinition, ValidationFieldError } from './types.js';

/**
 * Schema builder — fluent API for defining collection schemas.
 *
 * @example
 * const userSchema = {
 *   name: Schema.string().required(),
 *   email: Schema.string().email().required(),
 *   age: Schema.number().min(13).optional(),
 *   plan: Schema.enum(['free', 'pro']).default('free'),
 * };
 */
export const Schema = {
  string: () => new StringFieldBuilder(),
  number: () => new NumberFieldBuilder(),
  boolean: () => new BooleanFieldBuilder(),
  array: (items?: FieldBuilder) => new ArrayFieldBuilder(items),
  object: (properties?: Record<string, FieldBuilder>) => new ObjectFieldBuilder(properties),
  enum: (values: unknown[]) => new EnumFieldBuilder(values),
};

// ─── Field Builders ─────────────────────────────────────────────────────────

export abstract class FieldBuilder {
  protected def: SchemaFieldDefinition;

  constructor(type: SchemaFieldDefinition['type']) {
    this.def = { type, required: false };
  }

  required(): this {
    this.def.required = true;
    return this;
  }

  optional(): this {
    this.def.required = false;
    return this;
  }

  default(value: unknown): this {
    this.def.default = value;
    return this;
  }

  /** @internal - Get the raw field definition */
  build(): SchemaFieldDefinition {
    return { ...this.def };
  }
}

class StringFieldBuilder extends FieldBuilder {
  constructor() {
    super('string');
  }

  minLength(n: number): this {
    this.def.minLength = n;
    return this;
  }

  maxLength(n: number): this {
    this.def.maxLength = n;
    return this;
  }

  pattern(regex: string): this {
    this.def.pattern = regex;
    return this;
  }

  email(): this {
    this.def.email = true;
    return this;
  }

  url(): this {
    this.def.url = true;
    return this;
  }
}

class NumberFieldBuilder extends FieldBuilder {
  constructor() {
    super('number');
  }

  min(n: number): this {
    this.def.min = n;
    return this;
  }

  max(n: number): this {
    this.def.max = n;
    return this;
  }
}

class BooleanFieldBuilder extends FieldBuilder {
  constructor() {
    super('boolean');
  }
}

class ArrayFieldBuilder extends FieldBuilder {
  constructor(items?: FieldBuilder) {
    super('array');
    if (items) {
      this.def.items = items.build();
    }
  }
}

class ObjectFieldBuilder extends FieldBuilder {
  constructor(properties?: Record<string, FieldBuilder>) {
    super('object');
    if (properties) {
      this.def.properties = {};
      for (const [key, builder] of Object.entries(properties)) {
        this.def.properties[key] = builder.build();
      }
    }
  }
}

class EnumFieldBuilder extends FieldBuilder {
  constructor(values: unknown[]) {
    super('string');
    this.def.enum = values;
  }
}

// ─── Validator ──────────────────────────────────────────────────────────────

/**
 * Validate data against a schema definition.
 * @returns The validated data with defaults applied.
 * @throws ValidationError if validation fails.
 */
export function validateData(
  data: Record<string, unknown>,
  schema: Record<string, FieldBuilder> | SchemaDefinition
): Record<string, unknown> {
  const errors: ValidationFieldError[] = [];
  const result = { ...data };

  // Resolve schema: convert FieldBuilder instances to SchemaFieldDefinition
  const resolved: SchemaDefinition = {};
  for (const [key, value] of Object.entries(schema)) {
    if (value instanceof FieldBuilder) {
      resolved[key] = value.build();
    } else {
      resolved[key] = value as SchemaFieldDefinition;
    }
  }

  for (const [field, def] of Object.entries(resolved)) {
    const value = result[field];

    // Handle defaults
    if (value === undefined && def.default !== undefined) {
      result[field] = def.default;
      continue;
    }

    // Required check
    if (def.required && (value === undefined || value === null)) {
      errors.push({ field, message: 'is required', expected: def.type });
      continue;
    }

    // Skip validation if field is absent and not required
    if (value === undefined || value === null) continue;

    // Type check
    if (def.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push({ field, message: `expected array, got ${typeof value}`, expected: 'array', received: typeof value });
        continue;
      }
    } else if (typeof value !== def.type) {
      errors.push({ field, message: `expected ${def.type}, got ${typeof value}`, expected: def.type, received: typeof value });
      continue;
    }

    // Enum check
    if (def.enum && !def.enum.includes(value)) {
      errors.push({ field, message: `must be one of: ${def.enum.join(', ')}`, expected: def.enum.join('|'), received: String(value) });
    }

    // String validations
    if (def.type === 'string' && typeof value === 'string') {
      if (def.minLength !== undefined && value.length < def.minLength) {
        errors.push({ field, message: `must be at least ${def.minLength} characters` });
      }
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        errors.push({ field, message: `must be at most ${def.maxLength} characters` });
      }
      if (def.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors.push({ field, message: 'must be a valid email address' });
      }
      if (def.url) {
        try { new URL(value); } catch { errors.push({ field, message: 'must be a valid URL' }); }
      }
      if (def.pattern && !new RegExp(def.pattern).test(value)) {
        errors.push({ field, message: `must match pattern: ${def.pattern}` });
      }
    }

    // Number validations
    if (def.type === 'number' && typeof value === 'number') {
      if (def.min !== undefined && value < def.min) {
        errors.push({ field, message: `must be >= ${def.min}` });
      }
      if (def.max !== undefined && value > def.max) {
        errors.push({ field, message: `must be <= ${def.max}` });
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(errors);
  }

  return result;
}
