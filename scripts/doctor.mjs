import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';

const checks = [];
function result(name, ok, detail, fix) { checks.push({ name, ok, detail, fix }); }
function commandVersion(command, args = ['--version']) {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}
function checkPort(host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeout);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
result('Node.js 24 LTS', nodeMajor === 24, process.versions.node, '安装 Node.js 24 LTS；见 docs/BEGINNER_BUILD_GUIDE.md');
const pnpm = commandVersion(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
result('pnpm 11', Boolean(pnpm?.startsWith('11.')), pnpm ?? '未安装', '运行 corepack enable');
const docker = commandVersion('docker', ['--version']);
result('Docker', Boolean(docker), docker ?? '未安装或未启动', '安装并启动 Docker Desktop');
result('.env 文件', existsSync('.env'), existsSync('.env') ? '存在' : '不存在', '复制 .env.example 为 .env；不要提交 .env');

if (existsSync('.env')) {
  const text = readFileSync('.env', 'utf8');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET']) {
    const found = new RegExp(`^${key}=.+$`, 'm').test(text);
    result(`环境变量 ${key}`, found, found ? '已配置' : '缺失', `在 .env 中配置 ${key}`);
  }
}

result('PostgreSQL 端口', await checkPort('127.0.0.1', 5432), 'localhost:5432', '运行 docker compose up -d');
result('Redis 端口', await checkPort('127.0.0.1', 6379), 'localhost:6379', '运行 docker compose up -d');

let providerOk = false;
let providerDetail = '';
try {
  const response = await fetch('https://gamma-api.polymarket.com/events?limit=1', { signal: AbortSignal.timeout(5000) });
  providerOk = response.ok;
  providerDetail = `${response.status} ${response.statusText}`;
} catch (error) { providerDetail = error instanceof Error ? error.message : String(error); }
result('Polymarket Gamma API', providerOk, providerDetail, '检查网络、DNS、防火墙；数据源不可用时平台应只读降级');

console.log('\nEvent Forecast Lab · Doctor\n');
for (const check of checks) {
  console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
  if (!check.ok) console.log(`  修复：${check.fix}`);
}
const failures = checks.filter((check) => !check.ok);
console.log(`\n结果：${checks.length - failures.length}/${checks.length} 项通过。`);
if (failures.length > 0) process.exitCode = 1;
