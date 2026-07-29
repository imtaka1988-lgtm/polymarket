# 零基础搭建与验收手册

> 文档版本：V0.2  
> 适用系统：Windows 10/11  
> 假设：你不懂编程，不跳步，每一步成功后再继续。

## 0. 六个基础词

- 仓库：项目所有代码和文档，GitHub 保存远程副本。
- PowerShell：输入命令的窗口。
- 依赖：项目使用的现成软件包。
- 数据库：保存用户、市场、预测、积分、同步记录和结算。
- 环境变量：本机配置和秘密，不放进代码。
- 数据迁移：把代码中的数据库设计安全创建到 PostgreSQL。

## 1. 安装 Git

安装 Git for Windows，保持默认选项。验证：

```powershell
git --version
```

成功标志：显示 `git version ...`。

## 2. 安装 Node.js 24 LTS

```powershell
node -v
```

必须以 `v24.` 开头。

## 3. 启用 pnpm

```powershell
corepack enable
corepack prepare pnpm@11.4.0 --activate
pnpm -v
```

成功标志：11.x。

## 4. 安装 Docker Desktop

启动后执行：

```powershell
docker --version
docker compose version
```

## 5. 下载项目

```powershell
cd D:\
mkdir Projects
cd Projects
git clone https://github.com/imtaka1988-lgtm/polymarket.git
cd polymarket
Get-Location
Get-ChildItem
```

必须看到 `package.json`、`apps`、`packages`、`docs`。

已经下载过时：

```powershell
cd D:\Projects\polymarket
git status
git pull
```

若 `git status` 显示不认识的修改，先截图，不要执行 `git reset --hard`。

## 6. 创建本地配置

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

## 7. 安装依赖

```powershell
pnpm install
```

成功标志：无红色错误，出现 `node_modules` 和 `pnpm-lock.yaml`。

`pnpm-lock.yaml` 必须提交 GitHub，用于锁定依赖版本。若仓库没有锁文件，第一次安装后单独创建 PR 提交。

## 8. 启动数据库和 Redis

```powershell
docker compose up -d
docker compose ps
```

`postgres` 和 `redis` 必须 running/healthy。

停止：`docker compose stop`。  
删除容器但保留数据：`docker compose down`。  
`docker compose down -v` 会删除本地数据，只在明确重置时使用。

## 9. 生成和执行数据库迁移

```powershell
pnpm db:generate
pnpm db:migrate
```

目的：创建 Event、Market、同步 Cursor、运行记录、原始页、账本和结算等数据表。

成功标志：无红色错误，`packages/database/drizzle` 出现迁移文件，数据库完成迁移。

- 迁移文件属于项目代码，必须提交 GitHub；
- 不要手工在生产数据库创建表；
- 不要删除已经执行过的迁移；
- 迁移失败时保存完整错误和当前 Git Commit。

## 10. 环境自检

```powershell
pnpm doctor
```

它检查 Node、pnpm、Docker、`.env`、PostgreSQL、Redis 和 Polymarket 公开 API。失败时先修复。

## 11. 自动测试和构建验证

```powershell
pnpm test
pnpm verify
```

`pnpm test` 验证 Keyset URL、Cursor、重试和字段解析。`pnpm verify` 执行测试、类型检查和生产构建。

## 12. 启动项目

```powershell
pnpm dev
```

打开：

- http://localhost:3000
- http://localhost:4000/api/v1/health

Worker 会访问 Polymarket Keyset Event API 并写入 PostgreSQL。成功日志至少包含：

```text
provider_sync_page_committed
provider_sync_completed
```

## 13. 验证 Provider 同步

数据库应出现：

- `provider_sync_runs`
- `provider_sync_pages`
- `provider_sync_checkpoints`
- `provider_events`
- `provider_markets`
- `markets`
- `market_outcomes`

重复启动 Worker 后，应继续 Cursor，而不是永远只读第一页。

若出现 `provider_sync_failed`，阅读 `docs/POLYMARKET_DATA_INTEGRATION.md` 和 `docs/TROUBLESHOOTING_AND_SUPPORT.md`。

## 14. 健康检查

```powershell
pnpm health
```

## 15. 修改前

```powershell
git status
git pull
git switch -c feature/short-description
```

禁止在 main 直接写大量改动。

## 16. 每次改动必须同步文档

修改 Provider、数据库、Worker 或环境变量时，至少检查：

- `README.md`
- `CHANGELOG.md`
- `docs/ARCHITECTURE_AND_DATA.md`
- `docs/POLYMARKET_DATA_INTEGRATION.md`
- `docs/BEGINNER_BUILD_GUIDE.md`
- `docs/TROUBLESHOOTING_AND_SUPPORT.md`
- 对应 ADR 和 GitHub Issue

未更新文档视为功能未完成。

## 17. 发布前

```powershell
pnpm verify
git status
```

检查测试、类型、构建、迁移、文档、秘密和回滚说明。

## 18. 未知 Bug

1. 记录发生时间和时区；
2. 记录操作步骤；
3. 截图；
4. 保存完整错误；
5. 保存 Worker JSON 日志；
6. 运行 doctor、health、test、verify；
7. 记录 Git Commit；
8. 运行 support-bundle；
9. 阅读排错文档；
10. 把脱敏材料交给 AI 或外部工程师。

## 19. 验收表

- [ ] Git 可用
- [ ] Node 24.x
- [ ] pnpm 11.x
- [ ] Docker 正常
- [ ] 仓库下载完成
- [ ] `.env` 已创建且未提交
- [ ] 依赖安装完成
- [ ] `pnpm-lock.yaml` 已提交
- [ ] PostgreSQL healthy
- [ ] Redis healthy
- [ ] 数据迁移完成
- [ ] doctor 通过
- [ ] test 通过
- [ ] verify 通过
- [ ] Web 可打开
- [ ] API health 正常
- [ ] Worker Keyset 同步成功
- [ ] 同步运行、原始页和 Cursor 已入库
- [ ] 第二次同步能够恢复 Cursor
