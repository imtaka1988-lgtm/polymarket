import type { Pool, PoolClient } from 'pg';

export interface PostgresAdvisoryLock {
  healthCheck(): Promise<void>;
  release(): Promise<void>;
}

export async function tryAcquirePostgresAdvisoryLock(
  pool: Pool,
  lockName: string,
): Promise<PostgresAdvisoryLock | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [lockName],
    );
    if (result.rows[0]?.acquired !== true) {
      client.release();
      return null;
    }
    return createLock(client, lockName);
  } catch (error) {
    client.release();
    throw error;
  }
}

function createLock(client: PoolClient, lockName: string): PostgresAdvisoryLock {
  let released = false;

  return {
    async healthCheck(): Promise<void> {
      if (released) throw new Error(`advisory lock ${lockName} has already been released`);
      await client.query('SELECT 1');
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]);
      } finally {
        client.release();
      }
    },
  };
}
