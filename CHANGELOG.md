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
- CLOB REST `POST /books` 批量订单簿客户端、重试和官方契约测试；
- PostgreSQL Token Source，只订阅本地 `open` 且具有 Token ID 的 Outcome；
- `market_price_snapshots` 来源事件幂等键、来源 Hash、标准化证据和观察时间；
- `market_current_prices` 持久化 current price read model；
- bid、ask、midpoint、last trade 独立来源时间与乱序覆盖保护；
- 十进制定点 midpoint 计算，避免二进制浮点漂移；
- REST 启动快照与周期校准、WebSocket 串行有界写入队列；
- 实时 Worker Session Advisory Leader Lock 和失锁重试；
- 价格快照幂等、未知 Token、乱序事件和 Token Source PostgreSQL 集成测试；
- 正式迁移 `0001_silly_siren.sql` 和 ADR-0005；
- Gamma `GET /markets/{id}` 生命周期客户端、官方状态契约和严格 Outcome 证据解析；
- 近期关闭、已关闭和待解析市场的轮转回查与独立 Advisory Lock；
- 不可变 `market_lifecycle_observations` 和待人工复核 `market_resolution_candidates`；
- `provider_runtime_states` 与 `provider_alerts` 耐久运行状态；
- 连续失败、目录 Warning、价格缺失/陈旧、长时间断线、解析 Warning 和队列事件丢失告警；
- 告警恢复、生命周期幂等、禁止自动结算和轮转防饥饿 PostgreSQL 集成测试；
- Worker 停机停止新定时任务并等待目录、生命周期、健康检查和实时队列排空；
- 正式迁移 `0002_harsh_dark_beast.sql` 和 ADR-0006；
- V1 只读市场列表、详情、Outcome current price 和平台数据状态 API；
- `(updated_at,id)` Keyset Cursor、公开状态白名单和 1–100 bounded page size；
- healthy/degraded/unavailable 与保守 `readOnly` 聚合；
- 十进制价格字符串、稳定错误代码和端到端 Request ID；
- API PostgreSQL HTTP 集成测试和内部告警字段防泄漏回归测试；
- `docs/API_READ_CONTRACT.md` 和 ADR-0007；
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
- Provider/Worker 升级为 0.4.x、Database 升级为 0.2.x，M1.3b 实时价格数据闭环完成。
- Provider/Worker 升级为 0.5.x、Database 升级为 0.3.x，M1.4 Provider 运营后端完成。
- API 升级为 0.2.x，M1.5 版本化只读 API 完成。
- 数据库测试跨 Workspace 包串行，避免 API 与 Worker 验收清理互相污染。
- Turbo `test` 显式透传数据库验收环境；CI required integration Step 禁止 PostgreSQL 测试静默 SKIP。

### Known limitations

- CLOB 真实网络长期运行和部署环境恢复演练尚未完成；
- 管理后台和用户端只读页面尚未完成；
- 生产只读数据库角色、API 缓存和速率限制尚待部署配置；
- 真实官方 Fixture、长期契约变化监控和大数据性能测试尚未完成；

## [0.1.0] - 2026-07-29

- 项目工程基线建立。
