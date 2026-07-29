import { spawnSync } from 'node:child_process';
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(command, ['turbo', 'run', 'typecheck', 'build'], { stdio: 'inherit', env: process.env });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
