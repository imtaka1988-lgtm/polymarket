# ADR-0006：Provider 生命周期使用不可变观察、人工复核候选与耐久降级状态

- 状态：Accepted
- 日期：2026-07-29
- 决策人：项目负责人 + AI/Codex

## 背景

Gamma 目录主同步只拉取 `closed=false`，不能可靠发现市场关闭、重开、归档或解析状态变化。
官方 Market 状态中的 `closed` 表示市场已关闭或已解析，并不证明本地 Settlement 可以自动入账。
同时，进程内日志和计数在 Worker 重启后会丢失，前端和运维无法据此判断数据是否新鲜或应进入只读降级。

官方依据：

- <https://docs.polymarket.com/api-reference/markets/get-market-by-id>
- <https://docs.polymarket.com/market-data/market-details>
- <https://docs.polymarket.com/api-reference/markets/list-markets-keyset-pagination>

## 决策

1. Worker 使用 `GET /markets/{id}` 定时回查本地近期关闭、已关闭和待解析市场；
2. 生命周期回查使用独立 `polymarket:market-lifecycle:v1` Session Advisory Lock；
3. `market_lifecycle_observations` 保存每个去重后的官方状态证据，不覆盖历史；
4. `closed=true` 只把本地市场推进到 `closed`，不会自动写 `resolved_at`、赢家或账本；
5. 只有关闭市场同时出现“恰好一个 Outcome 价格为 1、其余全部为 0，且 Token 能匹配本地 Outcome”时，
   才记录赢家候选；证据不完整时仍可记录无赢家的待复核候选；
6. `market_resolution_candidates` 默认 `pending_review`，后续管理流程必须人工确认；
7. `provider_runtime_states` 保存组件健康状态、连续失败、最后成功/失败和指标；
8. `provider_alerts` 使用稳定 Dedup Key 保存打开/恢复的告警历史；
9. 价格缺失/陈旧、连续失败、长时间断线、解析 Warning、队列丢弃和写入失败都会进入耐久状态；
10. 未来只读 API 只从本地表计算 `healthy/degraded` 和 `readOnly`，不在请求期间调用 Provider。

## 不变量

- `closed` 不等于 `resolved`；
- Resolution Candidate 不得直接修改 `market_outcomes.is_winning_outcome`；
- Resolution Candidate 不得创建 Settlement、Prediction 结算或 Ledger Entry；
- 相同生命周期来源事件不得产生重复 Observation 或 Candidate；
- 失败时保留最后成功目录、价格和生命周期证据；
- 健康恢复必须重置连续失败并把对应告警标记为 `resolved`，不能删除告警历史；
- 回查必须按最后观察时间轮转，不能让大量已关闭市场长期饿死新到期市场。

## 代价

- 生命周期观察和告警会增加数据库写入量；
- 严格赢家证据会产生需要人工复核的无赢家候选；
- 各组件使用独立状态而不是一个全局布尔值，API 聚合逻辑更复杂，但能准确说明降级原因；
- 真实长期网络演练仍需在部署环境执行，CI 只验证确定性状态转换和恢复。

## 替代方案

### 把 `closed=true` 直接当作已结算

拒绝。官方语义不足以证明赢家和本地规则版本，也无法安全驱动积分账本。

### 只保留最新 Provider Market JSON

拒绝。无法审计状态变化、复核结算证据或解释错误转换。

### 只在日志系统保存健康状态

拒绝。开发基线尚未绑定特定日志供应商，且前端只读 API 需要可恢复的本地状态。
