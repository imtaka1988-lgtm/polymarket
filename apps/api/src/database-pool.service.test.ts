import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabasePoolService } from './database-pool.service';

test('database statement timeout configuration fails closed on invalid values', () => {
  const previous = process.env.API_DATABASE_STATEMENT_TIMEOUT_MS;
  process.env.API_DATABASE_STATEMENT_TIMEOUT_MS = '0';
  try {
    assert.throws(
      () => new DatabasePoolService(),
      /API_DATABASE_STATEMENT_TIMEOUT_MS must be a positive integer/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.API_DATABASE_STATEMENT_TIMEOUT_MS;
    } else {
      process.env.API_DATABASE_STATEMENT_TIMEOUT_MS = previous;
    }
  }
});
