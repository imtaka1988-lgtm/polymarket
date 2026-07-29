import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const tests = spawnSync(command, ['turbo', 'run', 'test', '--concurrency=1'], {
  stdio: 'inherit',
  env: process.env,
});

if (tests.error) {
  console.error(tests.error.message);
  process.exit(1);
}

if (tests.status !== 0) process.exit(tests.status ?? 1);

const checks = spawnSync(command, ['turbo', 'run', 'typecheck', 'build'], {
  stdio: 'inherit',
  env: process.env,
});

if (checks.error) {
  console.error(checks.error.message);
  process.exit(1);
}

process.exit(checks.status ?? 1);
