import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const directory = `support-bundle-${stamp}`;
mkdirSync(directory, { recursive: true });

function safeCommand(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { return `UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`; }
}

const system = {
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  osRelease: os.release(),
  node: process.version,
  pnpm: safeCommand(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--version']),
  gitCommit: safeCommand('git', ['rev-parse', 'HEAD']),
  gitBranch: safeCommand('git', ['branch', '--show-current']),
  gitStatus: safeCommand('git', ['status', '--short']),
  docker: safeCommand('docker', ['--version']),
};
writeFileSync(join(directory, 'SYSTEM_INFO.json'), JSON.stringify(system, null, 2));

if (existsSync('.env.example')) {
  const keys = readFileSync('.env.example', 'utf8').split(/\r?\n/).filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => line.split('=')[0]);
  writeFileSync(join(directory, 'EXPECTED_ENV_KEYS.txt'), keys.join('\n'));
}

writeFileSync(join(directory, 'ISSUE_REPORT.md'), `# Issue Report\n\n## 问题标题\n\n## 发生时间和时区\n\n## 影响环境\n- [ ] local\n- [ ] development\n- [ ] staging\n- [ ] production\n\n## 预期结果\n\n## 实际结果\n\n## 复现步骤\n1.\n2.\n3.\n\n## 最近一次正常版本\n\n## 已尝试的操作\n\n## 相关请求 ID、市场 ID 或用户匿名 ID\n\n## 安全确认\n- [ ] 没有包含密码、Token、Cookie、私钥\n- [ ] 没有包含用户个人信息\n- [ ] 日志已经脱敏\n`);
console.log(`已生成 ${directory}`);
console.log('交给外部工程师前，必须人工确认其中不含任何密钥或个人数据。');
