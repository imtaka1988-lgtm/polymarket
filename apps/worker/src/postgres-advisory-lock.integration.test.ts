import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { Pool } from 'pg';
import { tryAcquirePostgresAdvisoryLock } from './postgres-advisory-lock.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl === undefined ? test.skip : test;
let firstPool: Pool | undefined;
let secondPool: Pool | undefined;

before(async () => {
  if (databaseUrl === undefined) return;
  firstPool = new Pool({ connectionString: databaseUrl, max: 1 });
  secondPool = new Pool({ connectionString: databaseUrl, max: 1 });
  await Promise.all([firstPool.query('SELECT 1'), secondPool.query('SELECT 1')]);
});

after(async () => {
  await Promise.all([firstPool?.end(), secondPool?.end()]);
});

integrationTest('allows only one worker session to hold a query lock', async () => {
  const lockName = 'polymarket:events-keyset:v1:integration-lock';
  const firstLock = await tryAcquirePostgresAdvisoryLock(requirePool(firstPool), lockName);
  assert.notEqual(firstLock, null);

  const competingLock = await tryAcquirePostgresAdvisoryLock(requirePool(secondPool), lockName);
  assert.equal(competingLock, null);

  await firstLock?.release();

  const lockAfterRelease = await tryAcquirePostgresAdvisoryLock(requirePool(secondPool), lockName);
  assert.notEqual(lockAfterRelease, null);
  await lockAfterRelease?.release();
});

function requirePool(value: Pool | undefined): Pool {
  if (value === undefined) throw new Error('TEST_DATABASE_URL is required for integration tests');
  return value;
}
