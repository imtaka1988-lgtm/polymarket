# AGENTS.md

本文件是所有 AI、Codex、工程师和新聊天窗口进入本仓库后的第一入口。

## 1. 必须先读取

按顺序读取，并以仓库内容而不是聊天记忆作为事实来源：

1. `docs/AI_PROJECT_HANDOFF.md`
2. `docs/CURRENT_STATE.md`
3. `docs/PROJECT_MASTER_PLAN.md`
4. `docs/ARCHITECTURE_AND_DATA.md`
5. `docs/POLYMARKET_DATA_INTEGRATION.md`
6. `docs/DATABASE_ACCEPTANCE.md`
7. `docs/DEVELOPMENT_WORKFLOW.md`
8. `docs/TROUBLESHOOTING_AND_SUPPORT.md`
9. `docs/ROADMAP_CAPABILITY_MATRIX.md`
10. `docs/adr/` 中全部已接受 ADR
11. GitHub 当前打开的 Issues、最近合并的 PR 和 CI 状态

读取完成后，先用不超过十条说明：当前阶段、已完成能力、未完成能力、正在处理的 Issue、主要风险和下一步。不要在未读取仓库前根据旧聊天直接开发。

## 2. 项目定位

这是一个可扩展的娱乐型事件预测与游戏化互动平台。Polymarket 只是首个公开市场数据 Provider。

当前产品边界：

- 只使用无现金价值、不可购买、不可提现、不可转让的免费虚拟积分；
- 不接收真实资金；
- 不托管钱包或加密资产；
- 不替用户向 Polymarket 下真实订单；
- 不实现规避地区限制、KYC、AML 或平台规则的功能；
- 任何未来真钱、支付、托管或持牌业务必须是独立受监管系统。

## 3. 项目负责人的技术背景

项目负责人不懂编程。不要把本可自动化的技术验收推给项目负责人。

AI/工程师应负责：

- 编写代码；
- 编写和运行自动测试；
- 通过 CI 验证；
- 生成迁移；
- 更新文档；
- 根据日志排错；
- 明确说明真实完成度和剩余风险。

只有账号注册、密钥保管、视觉选择、业务规则确认和必须在用户设备上完成的操作，才交由项目负责人执行。

## 4. 强制工程规则

1. 不在 `main` 直接开发；一项任务一个分支和 PR。
2. 代码、测试、文档、Changelog 和施工 Issue 必须在同一 PR 更新。
3. 文档未更新，功能视为未完成。
4. 未通过 `pnpm test`、`pnpm typecheck` 和 `pnpm build` 不得合并。
5. 涉及数据库的功能必须有迁移和 PostgreSQL 集成测试。
6. CI 必须检查 Schema 与已提交迁移无漂移，并真实执行迁移。
7. 外部 API 原始字段只能出现在 Provider Adapter 和原始数据层。
8. Cursor 推进必须和页面数据写入处于同一数据库事务。
9. 同一 Query Signature 的多实例任务必须有分布式互斥。
10. 账本历史不得删除；错误通过冲正处理。
11. 不提交 `.env`、Token、Cookie、密码、私钥、生产数据或未脱敏日志。
12. 不以“页面能打开”代替可靠性、回滚和故障恢复验收。

## 5. 当前技术结构

- `apps/web`：Next.js 前端；
- `apps/api`：NestJS API；
- `apps/worker`：Provider 同步、未来实时行情接线、结算与异步任务；
- `packages/domain`：统一领域模型；
- `packages/database`：PostgreSQL/Drizzle Schema 和正式迁移；
- `packages/provider-polymarket`：Polymarket Gamma/CLOB 客户端、Token Registry、WebSocket 生命周期、解析、标准化和同步编排；
- `docs/`：项目事实、施工、排错和外援资料。

## 6. 标准验证

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm verify
```

数据库改动还必须通过 PostgreSQL 服务中的迁移、漂移检查和集成测试。

## 7. 每次任务结束前

必须更新：

- `docs/CURRENT_STATE.md`；
- 受影响的专项文档；
- `CHANGELOG.md`；
- 对应 GitHub Issue；
- PR 中的验证结果和已知限制。

完成度百分比必须标明评估口径，例如“Event Keyset 模块”与“整个 M1 数据闭环”不能混为一谈。
