import type { PolymarketEventRaw, PolymarketMarketRaw } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function asIsoDateString(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export function parseStringArray(value: unknown): { values: string[]; error: string | null } {
  if (value === undefined || value === null || value === '') return { values: [], error: null };

  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === 'string');
    return {
      values,
      error: values.length === value.length ? null : 'array contained non-string values',
    };
  }

  if (typeof value !== 'string') {
    return { values: [], error: `expected JSON string or array, received ${typeof value}` };
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return { values: [], error: 'JSON value was not an array' };
    const values = parsed.filter((item): item is string => typeof item === 'string');
    return {
      values,
      error: values.length === parsed.length ? null : 'JSON array contained non-string values',
    };
  } catch {
    return { values: [], error: 'invalid JSON array string' };
  }
}

export function isPolymarketEventRaw(value: unknown): value is PolymarketEventRaw {
  if (!isRecord(value)) return false;
  return asString(value.id) !== null && typeof value.title === 'string';
}

export function isPolymarketMarketRaw(value: unknown): value is PolymarketMarketRaw {
  if (!isRecord(value)) return false;
  return asString(value.id) !== null && typeof value.question === 'string';
}
