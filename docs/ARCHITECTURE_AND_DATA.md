# 系统架构、数据与核心规则

> 文档版本：V0.3  
> 最后更新：2026-07-29

## 1. 架构选择

采用 pnpm Monorepo、模块化单体、Web/API/Worker 独立进程、PostgreSQL 业务真相、Redis 缓存与任务、Transactional Outbox、Provider Adapter。暂不采用微服务和完整 Event Sourcing。

理由：两人可维护，同时保留拆分能力。

## 2. 运行组件

```text
浏览器 → Next.js Web → NestJS API → PostgreSQL/Redis
                               ↑
Worker（Provider同步、WebSocket、Outbox、结算、通知、数据保留）
                               ↑
Polymarket / Future Providers
```

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

M1.3b 将由 Worker 从 PostgreSQL 加载可订阅 Token，REST 提供初始订单簿和断线校准，
再把校准后的当前价格与历史快照写入缓存和 PostgreSQL。WebSocket 单独不能作为 Quote 或结算真相。

决策见 `docs/adr/0004-polymarket-clob-market-websocket.md`。

## 5. 数据库迁移与验收

正式迁移位于：

```text
packages/database/drizzle/
```

Drizzle Schema 位于：

```text
packages/database/src/schema.ts
packages/database/src/provider-sync-schema.ts
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

后续接入最后成功时间、同步延迟、Cursor 停滞、解析 Warning、连续失败、原始页大小和数据库写入耗时指标。

## 13. 扩展

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

## 14. 微服务拆分触发

仅在 Provider 同步影响 API、结算需独立扩容、通知量大、团队独立或合规隔离时拆分。优先候选：Provider、Realtime、Settlement、Notifications。

## 15. 当前已知架构缺口

- CLOB WebSocket 客户端基础已实现，Worker Token Source 和价格写入尚未实现；
- REST 初始行情和周期对账尚未实现；
- 关闭和结算市场的独立滚动回查尚未实现；
- 真实官方 Fixture 和长期契约监控尚未实现；
- 管理后台尚不能查看同步运行和 Warning；
- 数据延迟和连续失败告警尚未实现。
