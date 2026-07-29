# 零基础搭建与验收手册

> 文档版本：V0.3  
> 适用系统：Windows 10/11  
> 假设：你不懂编程。技术正确性由 AI/工程师和 GitHub Actions 验收，项目负责人不需要手工判断数据库事务或代码逻辑。

## 0. 七个基础词

- 仓库：项目所有代码和文档，GitHub 保存远程副本；
- PowerShell：输入命令的窗口；
- 依赖：项目使用的现成软件包；
- 数据库：保存用户、市场、预测、积分、同步记录和结算；
- 环境变量：本机配置和秘密，不放进代码；
- 数据迁移：把代码中的数据库设计安全创建到 PostgreSQL；
- CI：GitHub 自动执行迁移、测试、类型检查和构建。

## 1. 你的责任边界

你负责：

- 控制 GitHub 和云服务账号；
- 保管密码和密钥；
- 确认产品和视觉；
- 反馈页面体验；
- 在确实需要你的电脑或账号时按步骤操作。

AI/工程师负责：

- 写代码；
- 生成迁移；
- 自动测试；
- CI 验收；
- 定位 Bug；
- 更新文档；
- 说明真实完成度。

不要因为你不懂代码而自行尝试删除文件、重置数据库或修改配置。

## 2. 安装 Git

安装 Git for Windows，保持默认选项。验证：

```powershell
git --version
```

成功标志：显示 `git version ...`。

## 3. 安装 Node.js 24 LTS

```powershell
node -v
```

必须以 `v24.` 开头。

## 4. 启用 pnpm

```powershell
corepack enable
corepack prepare pnpm@11.4.0 --activate
pnpm -v
```

成功标志：11.x。

## 5. 安装 Docker Desktop

启动后执行：

```powershell
docker --version
docker compose version
```

## 6. 下载项目

```powershell
cd D:\
mkdir Projects
cd Projects
git clone https://github.com/imtaka1988-lgtm/polymarket.git
cd polymarket
Get-Location
Get-ChildItem
```

必须看到 `AGENTS.md`、`package.json`、`apps`、`packages` 和 `docs`。

已经下载过时：

```powershell
cd D:\Projects\polymarket
git status
git pull
```

若 `git status` 显示不认识的修改，先截图，不要执行 `git reset --hard`。

## 7. 创建本地配置

首次：

```powershell
Copy-Item .env.example .env
```

已经存在 `.env` 时不要覆盖。把 `SESSION_SECRET` 改成至少 32 位随机字符串。不要把 `.env` 发给任何人。

Provider 默认配置：

```dotenv
POLYMARKET_SYNC_PAGE_SIZE=100
POLYMARKET_SYNC_MAX_PAGES_PER_RUN=5
POLYMARKET_SYNC_ORDER=updatedAt,id
```

初次不要随意改大页数或缩短同步间隔。

## 8. 安装依赖

```powershell
pnpm install
```

成功标志：无红色错误，出现 `node_modules` 和 `pnpm-lock.yaml`。

`pnpm-lock.yaml` 必须提交 GitHub，用于锁定依赖版本。不要手工编辑该文件。

## 9. 启动本地数据库和 Redis

```powershell
docker compose up -d
docker compose ps
```

`postgres` 和 `redis` 必须 running/healthy。

停止：`docker compose stop`。  
删除容器但保留数据：`docker compose down`。  
`docker compose down -v` 会删除本地数据，除非文档明确要求重置，否则不要使用。

## 10. 本地执行正式迁移

正式迁移已由 Drizzle 生成并提交在：

```text
packages/database/drizzle/
```

本地只需要执行：

```powershell
pnpm db:migrate
```

通常不需要项目负责人运行 `pnpm db:generate`。该命令用于工程师修改 Schema 后生成新迁移，生成结果必须通过 PR 审查。

禁止：

- 手工创建生产表；
- 删除已执行迁移；
- 修改历史迁移掩盖错误；
- 使用 `drizzle-kit push` 替代生产迁移。

## 11. GitHub 已自动完成的技术验收

每次 PR 和 main 更新，GitHub Actions 会自动：

```text
启动 PostgreSQL 16
→ 检查 Schema 与迁移无漂移
→ 执行正式迁移
→ 运行 Provider 单元测试
→ 运行 PostgreSQL Store 集成测试
→ 验证原子提交、Cursor 恢复、幂等和故障回滚
→ 验证 Advisory Lock 多实例互斥
→ 验证锁连接池与业务连接池隔离，单连接 Store 不自阻塞
→ 验证失败页不进入 Checkpoint 累计计数
→ 严格类型检查
→ 生产构建
```

项目负责人不需要手工检查 SQL 表数量、事务回滚或锁竞争。CI 全绿是技术验收证据。

详细说明：`docs/DATABASE_ACCEPTANCE.md`。

## 12. 环境自检

```powershell
pnpm doctor
```

它检查 Node、pnpm、Docker、`.env`、PostgreSQL、Redis 和 Polymarket 公开 API。

## 13. 本地测试和构建

需要调试本机时：

```powershell
pnpm test
pnpm verify
```

本地没有 `TEST_DATABASE_URL` 时，PostgreSQL 集成测试可能跳过；完整数据库验收以 GitHub Actions 为准。

## 14. 启动项目

```powershell
pnpm dev
```

打开：

- http://localhost:3000
- http://localhost:4000/api/v1/health

Worker 成功日志至少可能包含：

```text
provider_sync_page_committed
provider_sync_completed
```

若另一个 Worker 已持有同一同步锁，可能看到：

```text
provider_sync_skipped
reason=distributed_lock_unavailable
```

这不是数据错误，表示另一个实例正在安全执行同步。

## 15. Provider 同步数据

数据库会使用：

- `provider_sync_runs`；
- `provider_sync_pages`；
- `provider_sync_checkpoints`；
- `provider_events`；
- `provider_markets`；
- `markets`；
- `market_outcomes`。

重复启动后会从数据库 Cursor 继续，不会永远只读第一页。

## 16. 健康检查

```powershell
pnpm health
```

## 17. 修改前

```powershell
git status
git pull
git switch -c feature/short-description
```

禁止在 main 直接写大量改动。

## 18. 每次改动必须同步文档

修改 Provider、数据库、Worker、CI 或环境变量时，至少检查：

- `AGENTS.md`；
- `README.md`；
- `CHANGELOG.md`；
- `docs/CURRENT_STATE.md`；
- `docs/AI_PROJECT_HANDOFF.md`；
- `docs/ARCHITECTURE_AND_DATA.md`；
- `docs/POLYMARKET_DATA_INTEGRATION.md`；
- `docs/DATABASE_ACCEPTANCE.md`；
- `docs/BEGINNER_BUILD_GUIDE.md`；
- `docs/TROUBLESHOOTING_AND_SUPPORT.md`；
- 对应 ADR 和 GitHub Issue。

文档未更新，功能视为未完成。

## 19. 未知 Bug

1. 记录发生时间和时区；
2. 记录操作步骤；
3. 截图；
4. 保存完整错误；
5. 记录 Git Commit、PR 和 CI Run ID；
6. 保存相关 Worker JSON 日志；
7. 运行 doctor、health、test、verify；
8. 运行 support-bundle；
9. 阅读专项排错文档；
10. 把脱敏材料交给 AI 或外部工程师。

## 20. 项目负责人最低验收表

- [ ] GitHub 仓库可以访问；
- [ ] main 分支 CI 全绿；
- [ ] `AGENTS.md` 和当前状态文档存在；
- [ ] `.env` 未提交；
- [ ] 页面体验符合当前阶段预期；
- [ ] 发现异常时能提供截图、时间、Commit 和 CI Run ID。

技术测试、数据库事务和分布式锁由 CI 验收，不要求项目负责人理解代码实现。
