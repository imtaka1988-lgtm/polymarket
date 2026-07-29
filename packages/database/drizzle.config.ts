import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema.ts', './src/provider-sync-schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://forecast:forecast@localhost:5432/forecast',
  },
  strict: true,
  verbose: true,
});
