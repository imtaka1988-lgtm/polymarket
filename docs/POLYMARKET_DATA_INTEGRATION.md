# Polymarket 数据接入与同步规范

> 文档版本：V0.2  
> 适用代码：`@forecast/provider-polymarket` 0.2.x、`@forecast/worker` 0.2.x  
> 最后更新：2026-07-29  
> 负责人：项目负责人 + AI/Codex  
> 状态：已实现基线，生产化继续迭代

## 1. 文档目的

本文档说明平台如何从 Polymarket 获取事件、市场和初始价格信息，如何安全分页、保存断点、处理错误、标准化字段、写入数据库，以及发生故障时如何自查和向外部工程师求助。

任何涉及 Polymarket 数据接入的代码变更，必须同步更新本文档、测试、变更日志和相关施工 Issue。代码已改但文档未改，视为未完成。

## 2. 当前边界

当前只接入公开数据，不进行用户钱包连接、Polymarket 真实下单、用户资产托管、真实充值提现或 Builder 订单归因。

Polymarket 是首个外部 Provider，不是平台内部业务真相。平台先保存原始数据，再转换为本地统一市场模型。

## 3. 官方接口依据

事件目录主入口：

- `GET https://gamma-api.polymarket.com/events/keyset`
- 官方文档：<https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination>

官方约束：

- 使用 `next_cursor` 作为下一页的 `after_cursor`；
- `offset` 在 Keyset 接口中被禁止，传入会返回 422；
- 默认 20 条，最大 500 条；
- 响应为 `{ events, next_cursor? }`；
- `next_cursor` 是不透明令牌，只能原样保存和传回；
- Event 默认携带 Markets、Tags、Series 和 EventCreators；
- Chats、Templates 和 BestLines 通过可选参数开启。

实时行情后续使用 CLOB WebSocket；Gamma Event 接口中的 `bestBid`、`bestAsk` 和 `lastTradePrice` 只作为目录导入时的初始参考，不作为长期实时行情主通道。

## 4. 为什么使用 Keyset，而不是 Offset

Offset 分页在数据持续新增或更新时，可能出现重复或遗漏。Keyset 由服务端返回游标，适合大规模、长时间、可恢复的同步。

正式同步使用 `/events/keyset`。普通 `/events?offset=...` 仅保留用于调试、小范围人工查询和兼容验证，不得作为正式全量同步主流程。

## 5. 运行数据流

```text
Worker 定时触发
→ 读取 query_signature 对应的数据库检查点
→ 请求 /events/keyset
→ 验证响应结构
→ 保存整页原始 JSON
→ 标准化 Event / Market / Outcome
→ 同一数据库事务写入原始表、标准表和新检查点
→ 提交事务后才允许使用 next_cursor 请求下一页
→ 记录同步运行结果、页数、事件数、警告和错误
```

核心原则：**数据提交与游标推进必须在同一事务内完成。** 禁止先保存游标再写数据。

## 6. 代码位置

```text
packages/provider-polymarket/src/
├── polymarket-client.ts
├── types.ts
├── parsers.ts
├── normalizer.ts
├── events-keyset-sync.ts
├── errors.ts
└── *.test.ts

apps/worker/src/
├── index.ts
└── postgres-events-sync-store.ts

packages/database/src/
└── provider-sync-schema.ts
```

## 7. Keyset 请求参数

代码支持官方页面列出的主要参数，包括分页、排序、ID/Slug、状态、标题搜索、流动性、成交量、时间窗口、Tag、Series、Game、父子 Event、Chat、Template、BestLines 和 Locale。

数组参数使用重复查询参数，例如：

```text
?tag_id=1&tag_id=2
```

### 当前 Worker 默认值

```text
limit=100
order=updatedAt,id
ascending=true
closed=false
include_children=true
每次最多5页
每60秒触发一次
```

这些值全部可以通过环境变量修改。`updatedAt,id` 是项目推荐排序；若真实接口返回 422，先核对官方支持字段，再临时改为 `id`，不能直接关闭响应验证。

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

建议 Page Size 为 50–200。不要一开始使用最大 500，因为嵌套 Markets 会使响应很大。

## 9. 数据库表

### `provider_sync_checkpoints`

每个固定查询条件保存 Provider、资源类型、Query Signature、下一 Cursor、累计页数和事件数，以及最后成功、失败和错误信息。

### `provider_sync_runs`

保存每一次 Worker 执行的 running/completed/partial/failed 状态、开始结束时间、页数、事件数、警告数、剩余 Cursor 和错误。

### `provider_sync_pages`

保存每一页 Request Cursor、Response Cursor、Request URL、完整原始 JSON、Event 数量、解析警告和 SHA-256 Page Key。

### 原始和标准化表

- `provider_events`
- `provider_markets`
- `markets`
- `market_outcomes`

## 10. Query Signature

Cursor 只对生成它的查询条件有效。系统删除 `afterCursor` 后，对其他参数稳定序列化：

```text
polymarket:events-keyset:v1:{...固定查询条件...}
```

修改 closed、标签、排序、日期、include_children 或 Locale 会产生新的同步链。禁止把旧查询 Cursor 手工复制给新查询。

## 11. 字段解析与标准化

官方部分字段可能是 JSON 字符串而不是数组：

- `outcomes`
- `outcomePrices`
- `clobTokenIds`
- `shortOutcomes`

解析器同时接受数组和 JSON 字符串。非法 JSON、非字符串元素或数量不一致时，原始值保留、生成结构化 Warning，并且不虚构 Outcome。

### 市场状态映射

```text
archived=true                 → archived
closed=true                   → closed
active=false                  → suspended
acceptingOrders=true          → open
其他                           → pending_review
```

不会仅凭外部字段把市场直接标为本地 `resolved`。正式结算必须进入独立结算证据链。

### 市场类型映射

- 体育字段存在：`sports`
- Yes/No：`binary`
- 超过两个 Outcome：`multi_outcome`

## 12. 重试策略

自动重试 429、500、502、503、504、网络错误和超时。不自动重试 400、401/403、404、422 和响应结构错误。

默认指数退避：500ms 起，最大 8 秒，最多 4 次，包含随机抖动。存在 `Retry-After` 时优先尊重服务端值。

## 13. 同步运行锁

Worker 当前使用进程内 `running` 标志避免同一进程重入。生产多实例运行前必须增加 PostgreSQL Advisory Lock 或分布式任务锁。

## 14. 日志事件

```text
provider_sync_page_committed
provider_sync_completed
provider_sync_failed
provider_sync_skipped
worker_shutdown_started
```

每条日志为 JSON。外部求助时优先提供这些事件附近的日志，不要提供 `.env`。

## 15. 本地搭建步骤

```powershell
git pull
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm test
pnpm verify
pnpm dev
```

若 `db:generate` 产生迁移文件，必须通过 PR 提交，不能只存在本机。

## 16. 成功标志

数据库出现同步运行、原始页、Cursor、Event、Market 和 Outcome 记录。Worker 日志出现：

```text
provider_sync_page_committed
provider_sync_completed
```

重复启动后应从数据库 Cursor 继续，而不是永远从第一页开始。

## 17. 常见故障

### 422：Offset is not allowed

检查是否调用旧 `/events` 客户端或手工拼接 URL。

### 422：Order 字段不支持

临时设置：

```dotenv
POLYMARKET_SYNC_ORDER=id
```

保存响应，确认官方文档后更新默认值、测试和本文档。

### 503：Keyset pagination is not configured

系统会退避重试。连续失败后保留旧数据和旧 Cursor，不能清库，也不能静默切换 Offset 继续写入。

### Cursor 不前进

系统主动终止以避免死循环。保存原始页、Request/Response Cursor 和 Run ID。

### 数据库表不存在

```powershell
pnpm db:generate
pnpm db:migrate
```

### Outcome 数量不一致

查看 `provider_sync_pages.raw_payload` 和 Warning。不要手工编造缺失 Token ID。

## 18. 外部求助最小资料

提供当前 Commit、时间和时区、Run ID、Query Signature、Request URL、HTTP 状态、相关 JSON 日志、原始页 ID、doctor/health/test/verify 结果和脱敏 Support Bundle。

不要提供 `.env`、数据库密码、Session Secret、完整生产数据库或用户个人信息。

## 19. 测试覆盖

当前自动测试覆盖：Keyset URL、不产生 Offset、数组参数、503 重试、Cursor 解析、字符串数组解析、两页同步和检查点推进。

仍需补充：真实官方 Fixture、PostgreSQL 容器集成测试、多实例锁、大数据性能和 CLOB WebSocket 断线测试。

## 20. 当前完成与后续

已完成 Keyset 客户端、Cursor 恢复、原始页保存、标准化、PostgreSQL 原子提交、运行记录、重试、单进程防重入、自动测试和文档。

后续重点：

1. 生成并提交正式数据库迁移；
2. 接入 CLOB Market WebSocket；
3. REST 行情对账；
4. 关闭和结算市场滚动回查；
5. 多实例分布式锁；
6. 管理后台同步监控；
7. 数据延迟和失败告警；
8. Provider Fixture 契约版本管理。
