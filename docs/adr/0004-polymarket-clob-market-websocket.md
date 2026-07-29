# ADR-0004：Polymarket CLOB Market WebSocket 实时行情基础

- 状态：Accepted
- 日期：2026-07-29
- 决策人：项目负责人 + AI/Codex

## 背景

Gamma Event Keyset 负责事件目录、规则和 Outcome Token ID，但目录响应中的价格字段不能作为长期实时行情。
平台需要公开、无需用户凭据的 CLOB Market Channel，持续获取订单簿、价格变化和最近成交，
同时允许市场集合变化时动态调整 Token 订阅。

官方依据：

- <https://docs.polymarket.com/api-reference/wss/market>
- <https://docs.polymarket.com/market-data/realtime-data>
- <https://docs.polymarket.com/market-data/prices-order-books>

## 决策

1. 使用公开地址 `wss://ws-subscriptions-clob.polymarket.com/ws/market`；
2. 只接入公开 Market Channel，不接入需要凭据的 User Channel；
3. 用 Token Subscription Registry 保存“期望订阅集合”，连接状态不是订阅真相；
4. 初次连接发送 `{type:"market", assets_ids:[...]}`；
5. 运行中使用 `{operation:"subscribe"|"unsubscribe", assets_ids:[...]}` 动态变更；
6. 每 10 秒发送文本帧 `PING`，接受文本帧 `PONG`；
7. 断线后使用带抖动的指数退避重连，每次新连接都从 Registry 完整重订阅；
8. 大订阅集合分批发送，首批使用初始订阅帧，其余使用动态订阅帧；
9. 外部 snake_case 字段只在 Provider Adapter 内解析，向上输出 camelCase 标准化事件；
10. 未识别事件保留事件类型并产生可观测 Warning，不因新事件类型让连接崩溃；
11. WebSocket 不是唯一行情真相。REST 初始快照、周期对账和价格持久化属于 M1.3 后续切片。

## 当前实现

- `market-token-subscription-registry.ts`：Token 集合、去重、替换和差异；
- `market-websocket.ts`：连接、心跳、动态订阅、重连、完整重订阅和内存指标；
- `market-websocket-contract.ts`：订单簿、价格变化、最近成交、Tick Size、Best Bid/Ask、New Market、Market Resolved 和未知事件解析；
- 对应单元、契约和模拟断线测试。

## 不变量

- 断线不能清空期望订阅集合；
- 重连成功后必须完整重订阅当前 Registry；
- 停止客户端或订阅集合为空时不得继续重连；
- 重复 Token 不得产生重复订阅；
- 无效 JSON、未知事件或局部非法字段不得使进程崩溃；
- 不在该连接上传输 API Key、Secret、Passphrase、钱包或真实订单。

## 代价

- 进程重启后 Registry 需要由数据库 Token Source 重建；
- WebSocket 消息可能丢失，因此必须建设 REST 初始快照和周期对账；
- 当前指标为进程内快照，后续仍需接入监控和告警系统；
- 当前切片不写入 `market_price_snapshots`，不能作为报价或结算依据。

## 替代方案

### 只轮询 REST

拒绝作为实时主通道。延迟和请求量较高，但 REST 仍作为初始化与校准通道。

### 直接使用 Gamma 价格字段

拒绝。Gamma 负责目录，不能替代长期 CLOB 实时行情。

### 接入 User Channel

拒绝。平台不进行真实交易，也不需要用户订单和成交凭据。

### 断线后只恢复增量差异

拒绝。断线期间无法确认服务端订阅状态，每次新连接必须完整重订阅。
