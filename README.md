# Event Forecast Lab

> **项目形态**：可扩展的娱乐型事件预测与游戏化互动平台  
> **当前阶段**：M1 Provider 数据闭环  
> **核心边界**：只使用无现金价值、不可购买、不可提现、不可转让的免费虚拟积分。

本项目以 Polymarket 公开市场数据作为首个外部来源。平台不依赖 Polymarket 用户账户、钱包或交易系统；所有模拟预测、积分、持仓与结算由本地系统管理。

## 新聊天、AI 或外部工程师从这里开始

**第一步必须读取根目录 [`AGENTS.md`](AGENTS.md)。**

随后按该文件要求读取：

1. [`docs/AI_PROJECT_HANDOFF.md`](docs/AI_PROJECT_HANDOFF.md)
2. [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md)
3. 当前 GitHub Issues、最近合并 PR 和 CI 状态

不要依赖旧聊天记忆直接修改代码。仓库 `main`、已合并 PR、打开的 Issue 和 CI 是事实来源。

## 当前已具备

- `apps/web`：Next.js 用户端；
- `apps/api`：NestJS 业务 API；
- `apps/worker`：Provider Keyset 同步与未来异步任务；
- `packages/domain`：统一市场、状态和领域事件；
- `packages/database`：PostgreSQL/Drizzle 数据模型；
- `packages/provider-polymarket`：Keyset 客户端、重试、解析、标准化和同步编排；
- PostgreSQL Cursor 检查点、同步运行、原始页、原始 Event/Market 和标准 Market/Outcome；
- 不可变虚拟积分账本、结算版本、Outbox、审计和功能开关基线；
- Doctor、Health、Verify、Support Bundle 与 GitHub Actions CI；
- 零基础施工、架构、Provider 接入、排错、安全和外部求助文档。

## 项目负责人阅读顺序

1. [`docs/BEGINNER_BUILD_GUIDE.md`](docs/BEGINNER_BUILD_GUIDE.md)
2. [`docs/PROJECT_MASTER_PLAN.md`](docs/PROJECT_MASTER_PLAN.md)
3. [`docs/ARCHITECTURE_AND_DATA.md`](docs/ARCHITECTURE_AND_DATA.md)
4. [`docs/POLYMARKET_DATA_INTEGRATION.md`](docs/POLYMARKET_DATA_INTEGRATION.md)
5. [`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md)
6. [`docs/TROUBLESHOOTING_AND_SUPPORT.md`](docs/TROUBLESHOOTING_AND_SUPPORT.md)

## Windows 本地启动

```powershell
git clone https://github.com/imtaka1988-lgtm/polymarket.git
cd polymarket
Copy-Item .env.example .env
pnpm install
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm doctor
pnpm test
pnpm verify
pnpm dev
```

默认地址：

- Web：http://localhost:3000
- API：http://localhost:4000/api/v1/health
- PostgreSQL：localhost:5432
- Redis：localhost:6379

## 常用命令

```bash
pnpm dev
pnpm test
pnpm build
pnpm typecheck
pnpm verify
pnpm doctor
pnpm health
pnpm support-bundle
pnpm db:generate
pnpm db:migrate
```

## 当前不是成品

当前完成了可验证的工程底座和 Event 目录同步基线。尚未完成完整用户系统、模拟预测闭环、管理后台和 CLOB 实时行情。详细状态以 [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) 和 Issue #2 为准。

## 安全底线

不要提交 `.env`、密码、Token、私钥、生产数据库、用户个人信息或未脱敏日志。真实资金、托管和持牌业务必须作为独立受监管系统。
