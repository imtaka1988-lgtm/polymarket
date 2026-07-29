# ADR-0007：版本化只读 API 与降级契约

- 状态：Accepted
- 日期：2026-07-29

## 背景

Worker 已把市场、Outcome、current price 和 Provider 健康状态耐久化。前端若直接读取数据库或调用
Polymarket，会复制外部契约、泄漏内部字段，并在 Provider 故障时丢失最后成功数据。价格使用
PostgreSQL `numeric`，直接转换为 JavaScript number 还会损失精度。

## 决策

1. 所有前端市场读取经 NestJS `/api/v1`，请求链路只访问本地 PostgreSQL；
2. V1 仅公开 open、suspended、closed、resolving、resolved 市场；
3. 列表以 `(updated_at DESC, id DESC)` 做 Keyset Cursor，不使用 Offset；
4. 价格和概率以十进制字符串输出，缺失值为 null；
5. Provider 状态通过 `/platform/data-status` 聚合；非 healthy 一律 `readOnly=true`；
6. Provider 无状态时返回 unavailable，不假设 healthy；
7. Provider 原始 payload、内部错误、告警 message/details 不进入公开 DTO；
8. 所有响应带 Request ID，错误使用稳定 code；
9. API CORS 只开放 GET、HEAD、OPTIONS，生产数据库账号应为只读角色；
10. API 与 Worker 的 PostgreSQL 测试跨包串行，避免清理操作互相污染。

## 后果

- 前端有稳定、可缓存、可追踪且不依赖 Provider 可用性的读取边界；
- V1 字段不能随内部 Schema 随意变化，破坏性变化必须创建新版本；
- 当前 Cursor 保证确定性遍历，但数据在翻页期间更新时可能移动位置；客户端刷新列表可获得新顺序；
- 管理端写操作、认证、缓存和速率限制不属于本 ADR，后续单独决策。
