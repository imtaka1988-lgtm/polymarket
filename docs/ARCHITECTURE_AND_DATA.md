# 系统架构、数据与核心规则

> 文档版本：V0.7
> 最后更新：2026-07-30

## 1. 架构选择

采用 pnpm Monorepo、模块化单体、Web/API/Worker 独立进程、PostgreSQL 业务真相、Transactional
Outbox 数据模型和 Provider Adapter。Redis 容器与环境变量已作为后续缓存和任务基础设施预留，
当前 M1 读路径、Provider 检查点和价格真相均不依赖 Redis。暂不采用微服务和完整 Event Sourcing。

理由：两人可维护，同时保留拆分能力。

## 2. 运行组件

```text
浏览器 → Next.js Web → NestJS API → PostgreSQL
                               ↑
Worker（当前：Provider同步、WebSocket、回查、监控；后续：Outbox、结算、通知、数据保留）
                               ↑
Polymarket / Future Providers
```

Redis 当前只存在于本地基础设施和环境自检中；正式接入缓存或任务前必须新增实现、失效策略、
故障降级、自动测试和对应 ADR，不能把 Redis 变成不可恢复的业务真相。

## 3. 模块边界

模块只能通过公开服务接口或领域事件协作，不能随意写对方数据。预测成功后发布 `PredictionPlaced`，任务、通知、排行榜和分析自行订阅。

## 4. Provider Adapter

```text
外部原始JSON
→ Provider HTTP Client
→ 响应结构验证
→ provider_sync_pages 保存整页证据
→ provider_events/provider_markets 原始表
→ Normalizer
→ 本地 markets/market_outcomes
```

业务代码不依赖 Polymarket 字段名，以便更换 API、增加 Provider、修复翻译、保存证据和离线降级。

### 4.1 Polymarket Event 主同步

正式使用 `GET /events/keyset`，不用 Offset 做全量主同步。Worker 从 PostgreSQL 读取 Cursor，顺序请求，每页成功写入原始数据、标准化数据和检查点后才请求下一页。

代码位置：

- `packages/provider-polymarket/src/polymarket-client.ts`
- `packages/provider-polymarket/src/events-keyset-sync.ts`
- `apps/worker/src/postgres-events-sync-store.ts`
- `packages/database/src/provider-sync-schema.ts`

详细规范见 `docs/POLYMARKET_DATA_INTEGRATION.md`。

### 4.2 同步一致性

一页同步在单一 PostgreSQL 事务中完成：

```text
保存原始页
→ Upsert Provider Event
→ Upsert Provider Market
→ Upsert 本地 Market
→ Upsert Outcome
→ 更新 Cursor 检查点
→ COMMIT
```

任何一步失败，事务回滚，Cursor 不推进。该行为已由 PostgreSQL 集成测试验证。

### 4.3 同步表

- `provider_sync_checkpoints`：Query Signature 和下一 Cursor；
- `provider_sync_runs`：每次执行状态和统计；
- `provider_sync_pages`：完整原始页和 Request/Response Cursor；
- `provider_events`：原始 Event；
- `provider_markets`：原始 Market。
- `market_price_snapshots`：REST/WebSocket 不可变价格更新；
- `market_current_prices`：按 Outcome 的耐久 current price read model。
- `market_lifecycle_observations`：不可变 Market 状态回查证据；
- `market_resolution_candidates`：待人工复核的关闭/赢家候选；
- `provider_runtime_states`：组件健康、连续失败和最后成功/失败；
- `provider_alerts`：可去重、可恢复且不删除历史的告警。

### 4.4 运行互斥

Worker 使用两层锁：

1. 进程内 `running` 标志；
2. PostgreSQL Session 级 Advisory Lock。

Advisory Lock 的逻辑名称使用 Query Signature。多个不同查询可并行，同一 Query Signature 同时只能由一个 Worker 实例执行。
锁使用独立的单连接 PostgreSQL Pool；Event Store 使用 `WORKER_DATABASE_POOL_SIZE`
控制的业务 Pool。两者不得复用，否则业务 Pool 只有一个连接时，锁会占用唯一连接并阻塞后续同步查询。

代码位置：

- `apps/worker/src/postgres-advisory-lock.ts`
- `apps/worker/src/postgres-advisory-lock.integration.test.ts`

### 4.5 实时行情边界

Gamma Keyset 解决目录、规则和 Token ID，不解决长期实时价格。

M1.3a 已建立 CLOB Market WebSocket Provider 基础：

- Token Subscription Registry 是期望订阅集合；
- 支持动态 subscribe/unsubscribe；
- 每 10 秒 `PING/PONG`；
- 断线指数退避和完整重订阅；
- 外部消息在 Provider Adapter 内标准化；
- 生命周期与 Warning 有进程内指标。

M1.3b 已完成实时价格数据闭环：

- Worker 从 PostgreSQL 加载本地 `open` Outcome Token；
- REST `POST /books` 提供启动快照和周期校准；
- WebSocket 提供低延迟增量；
- `market_price_snapshots` 保存不可变、幂等的价格证据；
- `market_current_prices` 保存可恢复的 current read model；
- bid、ask、midpoint、last trade 分别按来源时间保护，旧事件不能覆盖新字段；
- midpoint 使用十进制定点算法；
- WebSocket 通过有界串行队列写入；
- 只有持有实时 Session Advisory Lock 的 Worker 建立外部连接。

PostgreSQL current read model 是前端和未来 Quote 的耐久读取边界；Redis 以后只能作为可重建热缓存。
价格不能单独作为结算真相。

决策见 ADR-0004 和 ADR-0005。

### 4.6 生命周期与降级边界

M1.4 使用官方 `GET /markets/{id}` 轮转回查近期到期、已关闭和待解析市场。
同一市场在最近回查间隔内不会重复占用批次，避免大量已关闭市场饿死新到期市场。

```text
本地回查候选
→ Gamma Market 状态
→ 不可变 Lifecycle Observation
→ 保守更新本地 open/suspended/closed/archived
→ closed 时生成 pending_review Resolution Candidate
```

`closed=true` 不设置 `resolved_at`，不修改 `is_winning_outcome`，不创建 Settlement 或 Ledger。
只有恰好一个价格为 1、其余为 0 且 Token 匹配时 Candidate 才携带赢家 Outcome。

目录同步、生命周期、行情 REST、WebSocket、价格新鲜度和消息队列分别记录
`provider_runtime_states`。连续失败、Warning、陈旧价格、长时间断线和事件丢弃写入
`provider_alerts`；恢复时标记为 `resolved`，不删除历史。

决策见 ADR-0006。

## 5. 数据库迁移与验收

正式迁移位于：

```text
packages/database/drizzle/
```

Drizzle Schema 位于：

```text
packages/database/src/schema.ts
packages/database/src/provider-sync-schema.ts
packages/database/src/provider-operations-schema.ts
```

GitHub Actions 每次 PR 和 main Push 自动：

```text
启动 PostgreSQL 16
→ 重新检查 Schema 与迁移一致
→ 执行 pnpm db:migrate
→ 运行 PostgreSQL 集成测试
→ 类型检查
→ 生产构建
```

CI 已验证：

- 初始迁移可执行；
- 同步所需表存在；
- 页面和 Cursor 原子提交；
- 重复执行幂等；
- SQL 故障整页回滚；
- 失败页不进入 Checkpoint 累计计数；
- Advisory Lock 互斥、释放和单连接 Store 不自阻塞。

完整规范见 `docs/DATABASE_ACCEPTANCE.md`。

## 6. 市场状态机

```text
draft → pending_review → open → suspended/closed → resolving → resolved → archived
```

异常可进入 `cancelled`；resolved 错误不能删除，必须新结算版本冲正。Provider 导入阶段使用保守映射，`closed=true` 不自动等同于本地 `resolved`。

## 7. 报价

```text
请求报价 → 服务器最新快照 → quote_id/expires_at → 用户确认
→ 验证未过期/市场/余额 → 同一事务创建预测、账本和Outbox
```

必须保存价格、数据源、快照 ID、报价时间、失效时间和接受时间。

## 8. 账本

余额只是视图，账本流水是真相。双重记账要求每笔交易借贷相等、业务有唯一幂等键、历史不删除、修正通过反向交易、管理员调整有理由和审计。

资产代码如 `PLAY_COIN`、`RANK_POINT`、`XP`，不能隐式转换。

## 9. 结算

```text
检测结果 → 保存证据 → reviewing → 确认规则版本 → calculating
→ 生成明细 → posting → 原子写账本 → 一致性检查 → completed
```

重复执行依靠幂等不重复入账。错误结算保留原记录，创建 reversal 版本，冲正并重结算。

## 10. Transactional Outbox

业务数据和事件同事务写入；Worker 成功后写 `published_at`，失败增加尝试次数并退避，超限人工处理。

## 11. 数据保留

价格数据分层降采样。结算证据、账本、同步原始页和审计不能按普通日志随意删除。Provider 原始页长期保留周期将在 M1 运维策略中确定。

## 12. 可观测性

当前同步日志事件：

- `provider_sync_page_committed`
- `provider_sync_completed`
- `provider_sync_failed`
- `provider_sync_skipped`
- `worker_shutdown_started`

`provider_sync_skipped` 可区分进程重入和分布式锁不可用。

当前已持久化最后成功/失败、连续失败、解析 Warning、价格新鲜度、WebSocket 断线、
重连/消息指标、队列丢弃和恢复状态。版本化只读 API 聚合这些状态供前端与运维读取。

## 13. 版本化只读 API

`apps/api` 只查询本地 PostgreSQL，不在 HTTP 请求中临时调用 Provider：

```text
Next.js
→ GET /api/v1/markets
→ NestJS 稳定 DTO / Cursor / Error
→ markets + market_outcomes + market_current_prices
```

市场列表使用 `(updated_at DESC NULLS LAST, id DESC NULLS LAST)` Keyset Cursor；两列为
`NOT NULL`，显式 NULL 顺序用于确保查询排序与 Drizzle 索引规格完全匹配。详情和价格应用相同
公开状态白名单。
默认公开列表使用 `markets_public_feed_idx(status, updated_at DESC, id DESC)`；查询参数以
`market_status[]` 进入后先展开，再对每个状态做有界 LATERAL 等值索引扫描，最后合并候选。
这样 `status=all` 不会因 `ANY(array)` 无法提供单一等值排序保证而回退为全表扫描。
CI 会在 2 万行验收数据上检查实际执行计划和跨页不重不漏。

价格保留 PostgreSQL numeric 的十进制字符串。Provider 健康从 `provider_runtime_states` 和
`provider_alerts` 聚合为 healthy/degraded/unavailable，非 healthy 时 `readOnly=true`。
原始 payload、内部错误与告警详情不得进入公开 DTO。完整契约见 `docs/API_READ_CONTRACT.md`
和 ADR-0007。

API 数据库连接配置单条 statement timeout，避免异常查询长期占用连接池。`/health/live` 只检查
进程，`/health/ready` 真实查询 PostgreSQL；旧 `/health` 保持兼容。每个请求完成后输出带 Request ID、
HTTP 状态和耗时的结构化日志，慢请求与 5xx 升级为 warning，且不记录查询字符串。

## 14. 扩展

社交、房间、团队、任务、成就、赛季、用户市场、会员、AI 和 API 通过新增模块。真实支付、托管和真金下注必须独立系统。

新的 Provider 必须实现：

```text
原始数据获取
→ 结构验证
→ 标准化
→ 原始证据保存
→ 正式迁移
→ 可恢复检查点
→ 原子提交
→ 多实例互斥
→ 自动集成测试
→ 可观测运行记录
```

## 15. 微服务拆分触发

仅在 Provider 同步影响 API、结算需独立扩容、通知量大、团队独立或合规隔离时拆分。优先候选：Provider、Realtime、Settlement、Notifications。

## 16. 当前已知架构缺口

- CLOB WebSocket、Token Source、REST 校准和价格写入已实现；
- CLOB 与生命周期官方示例契约 Fixture 已实现；仍缺少脱敏真实网络 Event/Gamma 样本扩充和长期契约监控；
- 管理后台尚不能查看同步运行和 Warning；
- 版本化只读 API、查询索引、statement timeout、健康检查分层和耗时日志已实现；
- 生产只读数据库角色、缓存和速率限制仍待部署阶段配置；
- 真实网络长期恢复演练尚未在部署环境执行。
