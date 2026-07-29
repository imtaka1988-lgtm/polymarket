# 当前项目状态快照

> 状态日期：2026-07-29  
> 项目阶段：M1 Provider 数据闭环  
> 当前完成：M1.3a CLOB WebSocket 客户端基础
> 下一工作：M1.3b Token Source、REST 对账与价格持久化
> 权威任务：GitHub Issue #2  
> 状态规则：本文件每次功能 PR 必须更新

## 1. 已合并基线

- PR #1：工程、架构、文档、自检与 CI 基线；
- PR #3：Polymarket Events Keyset 可恢复同步；
- PR #4：正式迁移、PostgreSQL 自动验收、分布式锁和 AI/外援接管文档（本状态随 PR #4 合并生效）。
- PR #5：同步连接池隔离、失败页计数修复、单连接 Store 验收和冻结依赖基线。

## 2. 当前已经具备

- Next.js Web、NestJS API、Worker 独立应用；
- PostgreSQL/Drizzle Schema；
- 正式 Drizzle 初始迁移、Snapshot 和 Journal；
- CI 自动启动 PostgreSQL 16；
- CI 自动检查 Schema 与迁移无漂移；
- CI 自动执行迁移；
- Provider Adapter；
- `/events/keyset`；
- Cursor 检查点和 Query Signature；
- 超时、429/5xx 重试和指数退避；
- Event/Market/Outcome 安全解析与标准化；
- 原始页、同步运行和检查点持久化；
- 同一事务提交页面数据和 Cursor；
- 重复页面、Event、Market 和 Outcome 幂等；
- 持久化故障整页回滚；
- 进程内防重入；
- PostgreSQL Advisory Lock 多实例互斥；
- Advisory Lock 使用独立连接池，不占用 Store 业务连接；
- Store 连接池大小为 1 时完整同步仍可继续；
- 失败页面不会推进 Cursor、累计页数或累计事件数；
- Provider 单元测试和 PostgreSQL 集成测试；
- `pnpm-lock.yaml` 和 CI 冻结依赖安装；
- CI 测试、类型检查和生产构建；
- 根目录 `AGENTS.md`；
- AI/外部工程师完整接管文档；
- 零基础施工、外援、排错和架构文档。
- CLOB Market WebSocket 官方契约和 ADR-0004；
- Token Subscription Registry；
- 初始订阅、动态增加和动态删除订阅；
- 10 秒 `PING/PONG` 心跳；
- 断线指数退避、随机抖动和完整重订阅；
- 大 Token 集合批量订阅；
- Order Book、Price Change、Last Trade、Tick Size、Best Bid/Ask、New Market 和 Market Resolved 标准化；
- WebSocket 生命周期、消息和 Warning 进程内指标；
- 单元、官方契约 Fixture 和模拟断线测试。

## 3. M1.2 自动验收结果

GitHub Actions 已真实验证：

- Schema 与正式迁移同步；
- PostgreSQL 初始迁移执行成功；
- 同步所需表存在；
- 页面、标准化记录和 Cursor 原子提交；
- Cursor 可以从数据库恢复；
- 同一页面重复执行不产生重复记录；
- SQL 中途失败时页面、Event、Market、Outcome 和 Cursor 全部回滚；
- SQL 中途失败时失败页不会进入累计页数和累计事件数；
- 两个 Worker 会话不能同时持有同一 Query Signature 的 Advisory Lock；
- 锁释放后其他实例可以继续；
- 锁连接池与 Store 连接池隔离，Store 池大小为 1 时不会因锁占用而自阻塞；
- CI 只接受与已提交 `pnpm-lock.yaml` 一致的依赖树；
- 自动测试、严格类型检查和生产构建全部通过。

详细证据与排错路径见 `docs/DATABASE_ACCEPTANCE.md`。

## 4. 尚未完成

### M1.3 实时行情

- Worker 从 PostgreSQL 加载可订阅 Token 并维护 Registry；
- REST 初始订单簿/价格快照；
- 定时 REST 对账；
- 价格快照持久化；
- current price cache；
- 延迟、断线、连续失败和积压告警；
- 真实网络长期运行与恢复演练。

### M1.4 回查和运营

- 关闭/结算滚动回查；
- degraded/只读模式；
- 同步告警；
- 同步管理后台；
- 只读市场列表和详情页面。

### M2 预测闭环

- 身份；
- 免费积分；
- Quote；
- Prediction；
- Position；
- Settlement；
- Ledger 业务实现。

## 5. 当前已知风险

- Keyset 推荐排序 `updatedAt,id` 仍需要真实官方长期 Fixture 和契约验证；
- WebSocket 客户端基础已完成，但尚未接入数据库 Token Source 和价格持久化；
- 只有 WebSocket 没有 REST 对账会存在断线窗口数据缺口；
- 外部字段可能变化，必须保存原始响应并维护 Fixture；
- 不能把 `closed` 直接解释为本地已结算；
- 尚未完成 Provider 运行告警和管理后台；
- 当前不是可公开运营的成品。

## 6. 完成度口径

PR #5 可靠性验收和 M1.3a WebSocket 基础完成后的工程评估：

- Event Keyset 目录同步模块：约 96%；
- M1.2 数据库迁移与持久化可靠性：约 97%；
- M1.3a CLOB WebSocket 客户端基础：约 90%；
- 整个 M1 数据闭环：约 62%；
- 整个成熟娱乐平台：仍处于早期基础建设阶段，约 14%–17%。

剩余 Event Keyset 优化主要是：真实官方 Fixture、长期契约监控、大数据性能测试和运行告警。

## 7. 新接手者下一步

1. 读取根目录 `AGENTS.md`；
2. 读取 `docs/AI_PROJECT_HANDOFF.md`；
3. 读取 `docs/DATABASE_ACCEPTANCE.md`；
4. 查看 Issue #2；
5. 检查最新 main Commit、PR 和 GitHub Actions；
6. 进入 M1.3b Token Source、REST 对账和价格持久化，不要跳到用户预测或页面装饰。
