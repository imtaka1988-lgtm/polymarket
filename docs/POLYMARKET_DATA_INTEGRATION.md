# Polymarket 数据接入与同步规范

> 文档版本：V0.4
> 适用代码：`@forecast/provider-polymarket` 0.3.x、`@forecast/worker` 0.3.x
> 最后更新：2026-07-29  
> 负责人：项目负责人 + AI/Codex  
> 状态：Event Keyset、数据库可靠性和 CLOB WebSocket 基础已验证；REST 对账与价格持久化待建设

## 1. 文档目的

本文档说明平台如何从 Polymarket 获取事件和市场目录，如何安全分页、保存断点、处理错误、标准化字段、写入 PostgreSQL，以及发生故障时如何自查和向外部工程师求助。

任何 Polymarket 接入变更必须同时更新：

- 代码；
- 自动测试；
- 本文档；
- `docs/CURRENT_STATE.md`；
- `CHANGELOG.md`；
- 相关 GitHub Issue 和 PR。

代码已改但文档未改，视为未完成。

## 2. 当前边界

当前只接入公开数据，不进行：

- 用户钱包连接；
- Polymarket 真实下单；
- 用户资产托管；
- 真实充值提现；
- Builder 订单归因；
- 地区限制、KYC 或平台规则规避。

Polymarket 是首个外部 Provider，不是平台内部业务真相。平台先保存原始数据，再转换为本地统一市场模型。

## 3. 官方接口依据

事件目录主入口：

- `GET https://gamma-api.polymarket.com/events/keyset`
- 官方文档：<https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination>

已实现的官方约束：

- 使用 `next_cursor` 作为下一页 `after_cursor`；
- Keyset 主流程禁止 `offset`；
- 默认 20、最大 500；
- 响应验证为 `{ events, next_cursor? }`；
- Cursor 作为不透明令牌原样保存；
- Event 嵌套 Market 数据进入原始层和标准层。

Gamma 响应中的 `bestBid`、`bestAsk` 和 `lastTradePrice` 只作为目录导入参考。
正式实时行情需由 M1.3b 把 CLOB WebSocket、REST 对账和价格持久化接成闭环。

## 4. 为什么使用 Keyset

Offset 分页在数据持续新增或更新时可能重复或遗漏。Keyset 由服务端返回 Cursor，更适合长期、可恢复同步。

正式同步：

```text
/events/keyset
```

普通 `/events?offset=...` 只允许用于调试、小范围人工查询和兼容验证，不得作为全量主流程。

## 5. 运行数据流

```text
Worker 定时触发
→ 生成稳定 Query Signature
→ 尝试获得 PostgreSQL Advisory Lock
→ 读取该 Query Signature 的数据库 Cursor
→ 请求 /events/keyset
→ 验证响应结构
→ 保存整页原始 JSON
→ 标准化 Event / Market / Outcome
→ 同一事务写入原始页、原始表、标准表和新 Cursor
→ COMMIT 后才请求下一页
→ 记录同步运行、页数、事件数、Warning 和错误
→ finally 释放 Advisory Lock
```

核心不变量：

> 页面数据、标准化数据与 Cursor 推进必须在同一个 PostgreSQL 事务中完成。

禁止先保存 Cursor 再写数据。

## 6. 代码位置

```text
packages/provider-polymarket/src/
├── polymarket-client.ts
├── types.ts
├── parsers.ts
├── normalizer.ts
├── events-keyset-sync.ts
├── market-token-subscription-registry.ts
├── market-websocket-contract.ts
├── market-websocket.ts
├── errors.ts
└── *.test.ts

apps/worker/src/
├── index.ts
├── postgres-events-sync-store.ts
├── postgres-events-sync-store.integration.test.ts
├── postgres-advisory-lock.ts
└── postgres-advisory-lock.integration.test.ts

packages/database/
├── src/schema.ts
├── src/provider-sync-schema.ts
└── drizzle/
    ├── 0000_initial_platform.sql
    └── meta/
```

数据库验收细节见 `docs/DATABASE_ACCEPTANCE.md`。

## 7. Worker 默认查询

```text
limit=100
order=updatedAt,id
ascending=true
closed=false
include_children=true
每次最多5页
每60秒触发一次
```

`updatedAt,id` 是项目推荐排序，不是平台永久保证。若真实接口返回 422：

1. 保存状态、请求 URL 和响应；
2. 核对官方支持字段；
3. 临时设置 `POLYMARKET_SYNC_ORDER=id`；
4. 更新测试、本文档和 ADR；
5. 不得关闭响应验证掩盖问题。

## 8. 环境变量

```dotenv
POLYMARKET_GAMMA_BASE_URL=https://gamma-api.polymarket.com
POLYMARKET_SYNC_INTERVAL_MS=60000
POLYMARKET_REQUEST_TIMEOUT_MS=10000
POLYMARKET_SYNC_PAGE_SIZE=100
POLYMARKET_SYNC_MAX_PAGES_PER_RUN=5
POLYMARKET_SYNC_ORDER=updatedAt,id
POLYMARKET_RETRY_MAX_ATTEMPTS=4
POLYMARKET_RETRY_BASE_DELAY_MS=500
POLYMARKET_RETRY_MAX_DELAY_MS=8000
WORKER_DATABASE_POOL_SIZE=5
```

建议 Page Size 50–200。嵌套 Markets 可能使单页响应很大，不建议直接使用最大 500。

## 9. 数据库表

### 同步控制

- `provider_sync_checkpoints`：Cursor、累计页数、累计事件数和最近错误；
- `provider_sync_runs`：每次运行的 running/completed/partial/failed 状态；
- `provider_sync_pages`：请求 Cursor、响应 Cursor、URL、完整原始 JSON、Warning 和 Page Key。

### 原始层

- `provider_events`；
- `provider_markets`。

### 标准化层

- `markets`；
- `market_outcomes`。

正式迁移由 Drizzle 生成并提交在 `packages/database/drizzle/`。CI 会检查 Schema 与迁移无漂移并真实执行迁移。

## 10. Query Signature

Cursor 只对原始查询条件有效。系统去除 `afterCursor` 后稳定序列化其余参数：

```text
polymarket:events-keyset:v1:{...固定查询条件...}
```

修改状态、Tag、排序、日期、子事件或 Locale 会生成新的同步链。

Query Signature 同时作为 PostgreSQL Advisory Lock 名称。不同查询可以并行，同一查询在同一时刻只允许一个 Worker 执行。

## 11. 字段解析与标准化

以下字段可能是 JSON 字符串而不是数组：

- `outcomes`；
- `outcomePrices`；
- `clobTokenIds`；
- `shortOutcomes`。

解析器同时接受数组和 JSON 字符串。非法 JSON、非字符串元素或数量不一致时：

- 保留原始数据；
- 生成结构化 Warning；
- 不虚构 Outcome 或 Token ID；
- 不因单个可恢复字段错误清空历史数据。

### 市场状态映射

```text
archived=true        → archived
closed=true          → closed
active=false         → suspended
acceptingOrders=true → open
其他                 → pending_review
```

不会仅凭外部字段把市场直接标为本地 `resolved`。结算必须进入独立证据链。

### 市场类型映射

- 有体育字段：`sports`；
- Yes/No：`binary`；
- 超过两个 Outcome：`multi_outcome`。

## 12. 重试策略

自动重试：

- 429；
- 500、502、503、504；
- 网络错误；
- 超时。

不自动重试：

- 400；
- 401/403；
- 404；
- 422；
- 响应结构错误。

默认最多 4 次，500ms 起步，最大 8 秒，带随机抖动；存在 `Retry-After` 时优先使用服务端值。

## 13. 运行锁

Worker 使用两层保护。

### 进程内锁

`running` 标志防止同一进程的定时器重入。

### PostgreSQL Advisory Lock

`pg_try_advisory_lock(hashtextextended(query_signature, 0))` 防止多个 Worker 实例同时推进同一 Cursor。

锁由独立的单连接 PostgreSQL Pool 提供专用 PoolClient Session，并在同步结束或失败后的
`finally` 中释放。Event Store 使用另一业务连接池；即使
`WORKER_DATABASE_POOL_SIZE=1`，锁也不会占用 Store 的唯一连接。
另一个实例无法获得锁时记录：

```text
provider_sync_skipped
reason=distributed_lock_unavailable
```

自动集成测试已验证：互斥有效、释放后其他实例可以获得锁，并且单连接 Store 可以在锁持有期间完成整页同步。

## 14. 幂等与原子性

唯一身份：

- Event：`provider + provider_event_id`；
- Market：`provider + provider_market_id`；
- Outcome：`market_id + sort_order`；
- Raw Page：SHA-256 `page_key`；
- Checkpoint：`provider + resource_type + query_signature`。

同一页面重复执行不会增加重复记录。

持久化中途发生 SQL 错误时，Raw Page、Event、Market、Outcome 和 Cursor 全部回滚。该行为已由 PostgreSQL 集成测试验证。
累计页数、累计事件数和 Warning 数量只在 `commitPage()` 成功后推进；失败页不会污染 Checkpoint 统计，
后续重试仍从最后一次成功提交的 Cursor 和累计值继续。

## 15. 日志事件

```text
provider_sync_page_committed
provider_sync_completed
provider_sync_failed
provider_sync_skipped
worker_shutdown_started
```

每条日志为 JSON。`provider_sync_skipped` 的原因可能是：

- `previous_run_still_active`；
- `distributed_lock_unavailable`。

外部求助时优先提供相关时间范围的脱敏 JSON 日志。

## 16. 自动验收

GitHub Actions 每次 PR 和 main Push 自动：

1. 启动 PostgreSQL 16；
2. 检查 Schema 与正式迁移一致；
3. 执行数据库迁移；
4. 运行 Provider 单元测试；
5. 运行 Store PostgreSQL 集成测试；
6. 运行 Advisory Lock 集成测试；
7. 严格 TypeScript 检查；
8. 生产构建。

PR #4 已验证：

- 建表；
- 原子页面提交；
- Cursor 恢复；
- 重复执行幂等；
- 故障整页回滚；
- 多实例锁；
- 类型检查和构建。

项目负责人不需要手工判断这些技术结果。

## 17. 常见故障

### 422：Offset is not allowed

检查是否调用旧 `/events` 客户端或手工拼接 Offset。

### 422：Order 字段不支持

临时设置：

```dotenv
POLYMARKET_SYNC_ORDER=id
```

随后保存响应并更新测试、文档和 ADR。

### 503：Keyset pagination is not configured

系统会退避重试。连续失败后保留旧数据和 Cursor，不清库、不静默切 Offset。

### Cursor 不前进

系统主动停止，防止死循环。保存 Run ID、Query Signature、Request/Response Cursor 和原始页。

### 数据库迁移失败

查看 `docs/DATABASE_ACCEPTANCE.md`，检查 Migration、Schema、Enum、Foreign Key 和 CI PostgreSQL 状态。

### 分布式锁一直不可用

检查是否有旧 Worker Session 未结束、进程是否失去正常关闭能力，以及数据库连接是否长期占用。不要手工删除 Cursor。

### Outcome 数量不一致

检查 `provider_sync_pages.raw_payload` 和 Warning，不手工编造 Token ID。

## 18. 外部求助资料

提供：

- 当前 Commit、PR 和 CI Run ID；
- 时间与时区；
- Run ID 和 Query Signature；
- Request URL 和 HTTP 状态；
- Request/Response Cursor；
- 原始页 ID；
- 脱敏 JSON 日志；
- `docs/AI_PROJECT_HANDOFF.md`；
- `docs/DATABASE_ACCEPTANCE.md`；
- 本文档。

禁止提供 `.env`、密码、Token、私钥、完整生产数据库或用户数据。

## 19. CLOB Market WebSocket 基础

### 19.1 官方契约

- 地址：`wss://ws-subscriptions-clob.polymarket.com/ws/market`；
- 初始订阅：`{"type":"market","assets_ids":["<token_id>"]}`；
- 动态增加：`{"operation":"subscribe","assets_ids":["<token_id>"]}`；
- 动态删除：`{"operation":"unsubscribe","assets_ids":["<token_id>"]}`；
- 心跳：客户端每 10 秒发送文本 `PING`，服务端回复文本 `PONG`；
- 标准事件：`book`、`price_change`、`last_trade_price`、`tick_size_change`；
- 启用 `custom_feature_enabled` 后可接收 `best_bid_ask`、`new_market` 和 `market_resolved`。

官方文档：

- <https://docs.polymarket.com/api-reference/wss/market>
- <https://docs.polymarket.com/market-data/realtime-data>
- <https://docs.polymarket.com/market-data/prices-order-books>

### 19.2 Token Subscription Registry

Registry 保存进程当前“期望订阅集合”，负责：

- Token ID 去空白和去重；
- 动态增加、删除和全量替换；
- 生成 added/removed 差异；
- 提供排序后的确定性快照；
- 断线期间保留期望状态。

后续 Worker Token Source 必须从 PostgreSQL 中已审核、可交易的本地 Market/Outcome 重建 Registry，
不能把 WebSocket 当前连接状态当作业务真相。

### 19.3 连接生命周期

```text
Registry 非空
→ connecting
→ 打开连接
→ 发送完整初始订阅
→ 每 10 秒 PING
→ 动态 subscribe/unsubscribe
→ 断线
→ 指数退避加随机抖动
→ 新连接
→ 从 Registry 完整重订阅
```

停止客户端或 Registry 为空时取消重连并关闭空闲连接。大订阅集合按配置批量发送，
避免单一帧无限增长。

### 19.4 解析边界

Provider Adapter 将外部 snake_case 字段转换为内部 camelCase 事件，当前标准化：

- Order Book；
- Price Change；
- Last Trade Price；
- Tick Size Change；
- Best Bid/Ask；
- New Market；
- Market Resolved；
- 未知事件类型。

非法 JSON、非文本消息或缺少关键标识的事件产生 Warning，不让 Worker 崩溃。
外部原始字段不得泄漏到业务模块。

### 19.5 当前边界

本切片完成 WebSocket 客户端、Registry、心跳、动态订阅、重连、完整重订阅、解析和进程内指标。
尚未完成：

- Worker 从数据库加载 Token 并自动维护 Registry；
- REST 初始订单簿和周期对账；
- `market_price_snapshots` 写入；
- current price cache；
- 数据延迟、积压和连续断线告警；
- 真实网络长期运行与恢复演练。

因此当前 WebSocket 事件不能直接作为 Quote、预测或结算依据。

## 20. 当前测试覆盖

已覆盖：

- Keyset URL 和禁止 Offset；
- 数组参数；
- 503 重试；
- Cursor 解析和推进；
- 字符串数组解析；
- 两页同步编排；
- 正式迁移；
- 所需表存在；
- 页面原子提交；
- Cursor 恢复；
- 重复页面幂等；
- SQL 故障回滚；
- 失败页不推进累计计数；
- PostgreSQL Advisory Lock 互斥、释放与单连接 Store 不自阻塞。
- Token Registry 去重、增加、删除和替换；
- 官方 Order Book、Price Change、Last Trade、Tick Size、New Market 和 Market Resolved 契约 Fixture；
- 初始订阅、动态订阅和动态取消；
- 10 秒 `PING/PONG` 心跳；
- 指数退避重连和完整重订阅；
- 停止后不重连、空 Registry 关闭连接；
- 大 Token 集合批量订阅；
- 非法 JSON 和未知事件安全处理。

仍需补充：

- 脱敏真实官方 Fixture；
- 长期契约变化检测；
- 大数据量性能测试；
- 真实网络长连接和恢复演练；
- 运行指标与告警。

## 21. 当前完成度与下一步

工程评估：

- Event Keyset 目录同步模块：约 96%；
- 数据库迁移和持久化可靠性：约 97%；
- M1.3a CLOB WebSocket 客户端基础：约 90%；
- 整个 M1 数据闭环：约 62%。

下一阶段是 M1.3：

1. Worker 从 PostgreSQL 加载可订阅 Token，并维护 Registry；
2. REST 初始订单簿和周期对账；
3. `market_price_snapshots` 持久化；
4. current price cache；
5. 延迟、积压、断线和连续失败告警；
6. 真实网络恢复演练。
