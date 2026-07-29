# ADR-0003：Polymarket Event 目录使用 Keyset 分页

- 状态：Accepted
- 日期：2026-07-29
- 决策人：项目负责人 + AI/Codex

## 背景

Polymarket 同时提供传统 Offset Event 列表和 Keyset Event 列表。平台需要长期同步持续变化的大量事件，并在中断后恢复。

## 决策

正式 Event 目录同步使用 `GET /events/keyset`。普通 `/events` Offset 接口只用于调试、小范围查询和兼容验证。

同步检查点以 Query Signature 隔离；原始页、标准化数据和下一 Cursor 在同一 PostgreSQL 事务中提交。Worker 默认单线程顺序读取，每次限制页数，并对 429/5xx/超时进行指数退避。

## 原因

- 数据变化时比 Offset 更稳定；
- 原生支持断点续传；
- 适合大规模扫描；
- 可以将完整原始页作为证据和调试资料保存；
- 与 Provider Adapter 和 Worker 架构一致。

## 代价

- Cursor 不透明，不能人工解析；
- 查询条件变化会产生新的 Cursor 链；
- 需要检查点表、运行表和原始页表；
- 必须处理服务端 Cursor 不前进和 Keyset 503；
- 仍需另外接入 CLOB WebSocket 才能获得实时价格。

## 替代方案

### Offset 全量分页

拒绝作为主方案。持续变化的数据集可能出现重复和遗漏。

### 每次只抓第一页

拒绝。无法形成完整目录，也无法确认本地数据完整性。

### 直接让前端请求 Polymarket

拒绝。会使业务依赖外部 JSON、无法保存证据、无法统一翻译和降级。

## 后果

后续 Provider 必须实现相同的“原始数据→标准化→原子检查点”接口。任何改动同步更新 `POLYMARKET_DATA_INTEGRATION.md`。
