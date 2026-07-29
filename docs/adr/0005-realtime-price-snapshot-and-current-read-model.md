# ADR-0005：实时价格使用不可变快照与按字段时间保护的 Current Read Model

- 状态：Accepted
- 日期：2026-07-29
- 决策人：项目负责人 + AI/Codex

## 背景

CLOB WebSocket 提供低延迟增量，但可能断线、重放、乱序或漏失；REST Order Book 提供可校准的完整快照，
但不适合替代实时主通道。前端、Quote 和后续结算不能直接读取单次外部消息，也不能因旧消息晚到而让价格倒退。

官方依据：

- <https://docs.polymarket.com/api-reference/market-data/get-order-books-request-body>
- <https://docs.polymarket.com/api-reference/market-data/get-order-book>
- <https://docs.polymarket.com/market-data/prices-order-books>
- <https://docs.polymarket.com/api-reference/wss/market>

## 决策

1. Worker 只从 PostgreSQL 中本地状态为 `open`、具有 Polymarket Token ID 的 Outcome 建立订阅集合；
2. CLOB WebSocket 是低延迟增量通道，REST `POST /books` 是启动快照和周期校准通道；
3. 所有有效价格更新先追加到 `market_price_snapshots`，用 `source_event_key` 幂等去重；
4. `market_current_prices` 是持久化 Current Read Model，不替代不可变快照；
5. bid、ask、midpoint、last trade 分别保存来源时间，单个旧字段不得覆盖较新的同字段；
6. midpoint 使用十进制定点算法计算，不使用二进制浮点数直接相加；
7. WebSocket 消息进入有界串行队列，限制数据库并发；队列溢出必须记录丢弃并由 REST 校准恢复；
8. 同一时刻只允许一个 Worker 持有 `polymarket:market-realtime:v1` Session Advisory Lock；
9. 公开 Market Channel 和 REST 行情不需要 API Key、钱包或 User Channel 凭据；
10. PostgreSQL Current Read Model 是前端和 Quote 的耐久读取边界；Redis 只能作为以后可重建的热缓存。

## 不变量

- 未匹配本地 Outcome 的 Token 不得产生孤立快照；
- 重复 `source_event_key` 不得产生重复快照；
- 乱序消息可以保留为历史证据，但不得让 current 字段倒退；
- 没有官方来源时间的价格事件不得进入价格表；
- REST 校准失败时保留最后成功 current 值，不清空价格；
- WebSocket 与 REST 都不得绕过 Provider 标准化边界；
- 价格缓存不能直接成为市场结算证据。

## 代价

- 每个实时更新会增加历史快照写入量，需要后续分层保留和降采样；
- PostgreSQL current 表不是最低延迟缓存，但在前端开工前提供可审计、可恢复的稳定读取边界；
- 多实例只有实时 Leader 建立外部连接，故障接管依赖领导锁健康检查和重试；
- REST 周期校准增加外部请求量，需要批量、退避和监控。

## 替代方案

### 只保存最后价格

拒绝。无法审计、回放、诊断乱序或为 Quote 提供来源证据。

### 只保存 WebSocket

拒绝。断线窗口和漏失无法校准。

### 只使用 Redis

拒绝作为业务真相。Redis 数据可以丢失，且难以承担不可变证据和数据库事务验收。

### 每个 Worker 都建立实时连接

拒绝。会重复订阅、重复请求并放大外部和数据库负载。
