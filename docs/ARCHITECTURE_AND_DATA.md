# 系统架构、数据与核心规则

## 1. 架构选择

采用pnpm Monorepo、模块化单体、Web/API/Worker独立进程、PostgreSQL业务真相、Redis缓存与任务、Transactional Outbox、Provider Adapter。暂不采用微服务和完整Event Sourcing。

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

模块只能通过公开服务接口或领域事件协作，不能随意写对方数据。预测成功后发布`PredictionPlaced`，任务、通知、排行榜和分析自行订阅。

## 4. Provider Adapter

```text
外部原始JSON → provider_*原始表 → 标准化领域模型 → 本地markets/outcomes
```

业务代码不依赖Polymarket字段名，以便更换API、增加Provider、修复翻译、保存证据和离线降级。

## 5. 市场状态机

```text
draft → pending_review → open → suspended/closed → resolving → resolved → archived
```

异常可进入cancelled；resolved错误不能删除，必须新结算版本冲正。

## 6. 报价

```text
请求报价 → 服务器最新快照 → quote_id/expires_at → 用户确认
→ 验证未过期/市场/余额 → 同一事务创建预测、账本和Outbox
```

必须保存价格、数据源、快照ID、报价时间、失效时间和接受时间。

## 7. 账本

余额只是视图，账本流水是真相。双重记账要求每笔交易借贷相等、业务有唯一幂等键、历史不删除、修正通过反向交易、管理员调整有理由和审计。

资产代码如`PLAY_COIN`、`RANK_POINT`、`XP`，不能隐式转换。

## 8. 结算

```text
检测结果 → 保存证据 → reviewing → 确认规则版本 → calculating
→ 生成明细 → posting → 原子写账本 → 一致性检查 → completed
```

重复执行依靠幂等不重复入账。错误结算保留原记录，创建reversal版本，冲正并重结算。

## 9. Transactional Outbox

业务数据和事件同事务写入；Worker成功后写`published_at`，失败增加尝试次数并退避，超限人工处理。防止核心业务成功但异步模块永久丢失。

## 10. 数据保留

价格数据分层降采样：近7天高粒度、8–30天分钟级、31–365天更低粒度、长期小时或日级。结算证据、账本和审计不能按普通日志删除。

## 11. 扩展

社交、房间、团队、任务、成就、赛季、用户市场、会员、AI和API通过新增模块。真实支付、托管和真金下注必须独立系统。

## 12. 微服务拆分触发

仅在Provider同步影响API、结算需独立扩容、通知量大、团队独立或合规隔离时拆分。优先候选：Provider、Realtime、Settlement、Notifications。
