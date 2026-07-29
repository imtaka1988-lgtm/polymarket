# Event Forecast Lab

> **项目形态**：可扩展的娱乐型事件预测与游戏化互动平台  
> **当前阶段**：M1 Provider 数据闭环  
> **已完成阶段**：M1.4 Provider 生命周期回查、降级与可观测性后端
> **下一阶段**：前端可依赖的版本化只读 API
> **核心边界**：只使用无现金价值、不可购买、不可提现、不可转让的免费虚拟积分。

本项目以 Polymarket 公开市场数据作为首个外部来源。平台不依赖 Polymarket 用户账户、钱包或交易系统；所有模拟预测、积分、持仓与结算由本地系统管理。

## 新聊天、AI 或外部工程师从这里开始

**第一步必须读取根目录 [`AGENTS.md`](AGENTS.md)。**

随后按该文件要求读取：

1. [`docs/AI_PROJECT_HANDOFF.md`](docs/AI_PROJECT_HANDOFF.md)
2. [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md)
3. [`docs/DATABASE_ACCEPTANCE.md`](docs/DATABASE_ACCEPTANCE.md)
4. 当前 GitHub Issues、最近合并 PR 和 CI 状态

不要依赖旧聊天记忆直接修改代码。仓库 `main`、已合并 PR、打开的 Issue 和 CI 是事实来源。

## 当前已具备

- `apps/web`：Next.js 用户端；
- `apps/api`：NestJS 业务 API；
- `apps/worker`：Provider Keyset 同步、实时行情、生命周期回查、健康监控与异步任务；
- `packages/domain`：统一市场、状态和领域事件；
- `packages/database`：PostgreSQL/Drizzle Schema、Provider 运行状态和正式迁移；
- `packages/provider-polymarket`：Keyset/CLOB 客户端、Token Registry、WebSocket 生命周期、重试、解析、标准化和同步编排；
- PostgreSQL Cursor 检查点、同步运行、原始页、原始 Event/Market 和标准 Market/Outcome；
- 页面数据与 Cursor 原子事务；
- 重复同步幂等和故障整页回滚；
- 进程内锁和 PostgreSQL Advisory Lock；
- CLOB Market WebSocket 动态订阅、心跳、重连、完整重订阅和契约测试；
- PostgreSQL Token Source、REST `/books` 初始快照和周期校准；
- 不可变价格快照、乱序保护的 current price read model 和实时 Leader Lock；
- 生命周期不可变观察、待人工复核 Resolution Candidate 和独立回查锁；
- 耐久 Provider Runtime State 与可恢复告警；
- GitHub Actions PostgreSQL 16、迁移漂移检查、自动迁移和集成测试；
- 不可变虚拟积分账本、结算版本、Outbox、审计和功能开关基线；
- Doctor、Health、Verify、Support Bundle；
- 零基础施工、架构、Provider、数据库、排错、安全和外部求助文档。

## 项目负责人阅读顺序

1. [`docs/BEGINNER_BUILD_GUIDE.md`](docs/BEGINNER_BUILD_GUIDE.md)
2. [`docs/PROJECT_MASTER_PLAN.md`](docs/PROJECT_MASTER_PLAN.md)
3. [`docs/ARCHITECTURE_AND_DATA.md`](docs/ARCHITECTURE_AND_DATA.md)
4. [`docs/POLYMARKET_DATA_INTEGRATION.md`](docs/POLYMARKET_DATA_INTEGRATION.md)
5. [`docs/DATABASE_ACCEPTANCE.md`](docs/DATABASE_ACCEPTANCE.md)
6. [`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md)
7. [`docs/TROUBLESHOOTING_AND_SUPPORT.md`](docs/TROUBLESHOOTING_AND_SUPPORT.md)

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

当前完成了工程底座、Event 目录同步、数据库可靠性验收、CLOB 实时价格闭环和 M1.4 运营后端。
尚未完成版本化只读 API、真实网络长期演练、完整用户系统、模拟预测闭环和管理页面。
详细状态以 [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) 和 Issue #2 为准。

## 安全底线

不要提交 `.env`、密码、Token、私钥、生产数据库、用户个人信息或未脱敏日志。真实资金、托管和持牌业务必须作为独立受监管系统。
