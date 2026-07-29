# 系统架构、数据与核心规则

> 文档版本：V0.2  
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

任何一步失败，事务回滚，Cursor 不推进。

### 4.3 同步表

- `provider_sync_checkpoints`：Query Signature 和下一 Cursor；
- `provider_sync_runs`：每次执行状态和统计；
- `provider_sync_pages`：完整原始页和 Request/Response Cursor；
- `provider_events`：原始 Event；
- `provider_markets`：原始 Market。

### 4.4 实时行情边界

Gamma Keyset 解决目录、规则和初始字段，不解决长期实时价格。后续 CLOB WebSocket 将更新当前价格缓存和历史价格快照，REST 用于断线校准。

## 5. 市场状态机

```text
draft → pending_review → open → suspended/closed → resolving → resolved → archived
```

异常可进入 `cancelled`；resolved 错误不能删除，必须新结算版本冲正。Provider 导入阶段使用保守映射，`closed=true` 不自动等同于本地 `resolved`。

## 6. 报价

```text
请求报价 → 服务器最新快照 → quote_id/expires_at → 用户确认
→ 验证未过期/市场/余额 → 同一事务创建预测、账本和Outbox
```

必须保存价格、数据源、快照 ID、报价时间、失效时间和接受时间。

## 7. 账本

余额只是视图，账本流水是真相。双重记账要求每笔交易借贷相等、业务有唯一幂等键、历史不删除、修正通过反向交易、管理员调整有理由和审计。

资产代码如 `PLAY_COIN`、`RANK_POINT`、`XP`，不能隐式转换。

## 8. 结算

```text
检测结果 → 保存证据 → reviewing → 确认规则版本 → calculating
→ 生成明细 → posting → 原子写账本 → 一致性检查 → completed
```

重复执行依靠幂等不重复入账。错误结算保留原记录，创建 reversal 版本，冲正并重结算。

## 9. Transactional Outbox

业务数据和事件同事务写入；Worker 成功后写 `published_at`，失败增加尝试次数并退避，超限人工处理。

## 10. 数据保留

价格数据分层降采样。结算证据、账本、同步原始页和审计不能按普通日志随意删除。Provider 原始页长期保留周期将在 M1 运维策略中确定。

## 11. 可观测性

当前同步日志事件：

- `provider_sync_page_committed`
- `provider_sync_completed`
- `provider_sync_failed`
- `provider_sync_skipped`

后续接入最后成功时间、同步延迟、Cursor 停滞、解析 Warning、连续失败、原始页大小和数据库写入耗时指标。

## 12. 扩展

社交、房间、团队、任务、成就、赛季、用户市场、会员、AI 和 API 通过新增模块。真实支付、托管和真金下注必须独立系统。

新的 Provider 必须实现：

```text
原始数据获取 → 结构验证 → 标准化 → 原始证据保存 → 可恢复检查点 → 可观测运行记录
```

## 13. 微服务拆分触发

仅在 Provider 同步影响 API、结算需独立扩容、通知量大、团队独立或合规隔离时拆分。优先候选：Provider、Realtime、Settlement、Notifications。

## 14. 当前已知架构缺口

- Worker 仅有进程内防重入，多实例需要 PostgreSQL Advisory Lock；
- CLOB WebSocket 尚未实现；
- 关闭和结算市场的独立滚动回查尚未实现；
- PostgreSQL 容器集成测试尚未进入 CI；
- 管理后台尚不能查看同步运行和 Warning；
- 数据迁移文件需要生成并提交。
