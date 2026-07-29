const targets = [
  ['Web', 'http://localhost:3000'],
  ['API', 'http://localhost:4000/api/v1/health'],
  ['Polymarket Gamma', 'https://gamma-api.polymarket.com/events?limit=1'],
];
console.log('\nEvent Forecast Lab · Health\n');
let failed = 0;
for (const [name, url] of targets) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const ok = response.ok;
    console.log(`${ok ? '✓' : '✗'} ${name.padEnd(20)} ${response.status} ${Date.now() - startedAt}ms`);
    if (!ok) failed += 1;
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name.padEnd(20)} ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failed > 0) process.exitCode = 1;
