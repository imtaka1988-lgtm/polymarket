export function integrationTestDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL;
  if (process.env.REQUIRE_TEST_DATABASE === 'true' && value === undefined) {
    throw new Error('TEST_DATABASE_URL is required when REQUIRE_TEST_DATABASE=true');
  }
  return value;
}
