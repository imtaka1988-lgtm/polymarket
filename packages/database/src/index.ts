import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as coreSchema from './schema.js';
import * as providerOperationsSchema from './provider-operations-schema.js';
import * as providerSyncSchema from './provider-sync-schema.js';

const schema = { ...coreSchema, ...providerOperationsSchema, ...providerSyncSchema };

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export * from './provider-operations-schema.js';
export * from './provider-sync-schema.js';
export * from './schema.js';
