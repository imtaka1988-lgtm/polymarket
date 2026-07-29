# Changelog

所有重要变更记录在此文件。

格式遵循 Keep a Changelog 的思想，版本号采用语义化版本。

## [Unreleased]

### Added

- Polymarket Events Keyset 分页客户端和完整查询参数映射；
- Cursor 检查点、同步运行和原始页 PostgreSQL 数据模型；
- Keyset 分页恢复、每页原子提交和 Query Signature；
- 429/5xx/超时重试、指数退避和 Retry-After 支持；
- Polymarket 字符串数组字段安全解析和结构化 Warning；
- Event/Market/Outcome 标准化与 PostgreSQL Upsert；
- 正式 Drizzle 初始迁移、Snapshot 和 Journal；
- GitHub Actions PostgreSQL 16 测试服务；
- Schema 与迁移漂移检查；
- PostgreSQL Store 集成测试：建表、原子提交、Cursor 恢复、重复同步和故障回滚；
- PostgreSQL Advisory Lock 多实例互斥；
- Advisory Lock 独立连接池和单连接 Store 完整同步集成测试；
- 失败页面不污染 Checkpoint 累计页数和事件数的回归测试；
- `pnpm-lock.yaml` 可重复依赖基线；
- Polymarket CLOB Market WebSocket 客户端基础；
- Token Subscription Registry 和确定性订阅差异；
- WebSocket 初始订阅、动态 subscribe/unsubscribe 和批量帧；
- 10 秒 `PING/PONG` 心跳；
- 带随机抖动的指数退避重连和完整重订阅；
- Order Book、Price Change、Last Trade、Tick Size、Best Bid/Ask、New Market 和 Market Resolved 标准化；
- WebSocket 生命周期、消息、Warning 和最近时间进程内指标；
- 官方契约 Fixture、动态订阅和模拟断线测试；
- ADR-0004 CLOB Market WebSocket 决策；
- 根目录 `AGENTS.md`；
- `docs/AI_PROJECT_HANDOFF.md`；
- `docs/CURRENT_STATE.md`；
- `docs/DATABASE_ACCEPTANCE.md`；
- `docs/POLYMARKET_DATA_INTEGRATION.md` 和 ADR-0003；
- Provider 施工、排错、外援和路线图文档同步。

### Changed

- Worker 从 Offset 首页面连通性测试升级为可恢复 Keyset 同步；
- Worker 从单进程防重入升级为进程内锁加 PostgreSQL Advisory Lock，锁连接与业务 Store 连接池隔离；
- 页面累计计数只在数据库事务提交成功后推进；
- `pnpm verify` 和 CI 增加自动测试；
- CI 改为冻结锁文件安装依赖，禁止依赖解析结果静默漂移；
- CI 在测试前检查迁移漂移并执行正式迁移；
- 数据库技术验收从项目负责人手工操作改为 GitHub Actions 自动验证；
- README 将 AI、新聊天和外部工程师接管入口置于首位；
- 项目阶段升级为 M1.2 数据库迁移与可靠性基线完成；
- Provider 包升级为 0.3.x，M1.3a CLOB WebSocket 客户端基础完成。

### Known limitations

- Worker Token Source、REST 行情对账、价格快照写入和 current cache 尚未完成；
- CLOB 真实网络长期运行、延迟/积压告警和恢复演练尚未完成；
- 关闭/结算回查和管理后台尚未完成；
- 真实官方 Fixture、长期契约变化监控和大数据性能测试尚未完成；
- 数据延迟和连续失败告警尚未完成。

## [0.1.0] - 2026-07-29

- 项目工程基线建立。
