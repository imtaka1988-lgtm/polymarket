# Changelog

所有重要变更记录在此文件。

格式遵循 Keep a Changelog 的思想，版本号采用语义化版本。

## [Unreleased]

### Added

- Polymarket Events Keyset 分页客户端和完整查询参数映射；
- Cursor 检查点、同步运行和原始页 PostgreSQL 数据模型；
- Keyset 分页恢复、每页原子提交和 Query Signature；
- 429/5xx/超时重试、指数退避和 Retry-After 支持；
- Polymarket 字符串数组字段安全解析和结构化 Warning；
- Event/Market/Outcome 标准化与 PostgreSQL Upsert；
- Worker 防重入、分页进度和结构化日志；
- Provider Keyset 自动测试；
- `docs/POLYMARKET_DATA_INTEGRATION.md` 和 ADR-0003；
- Provider 施工、排错、外援和路线图文档同步。

### Changed

- Worker 从 Offset 首页面连通性测试升级为可恢复 Keyset 同步；
- `pnpm verify` 和 CI 增加自动测试；
- 本地搭建流程增加数据库迁移步骤；
- 项目阶段升级为 Provider 数据同步基线 V0.2。

### Known limitations

- CLOB WebSocket、REST 行情对账、关闭/结算回查、管理后台和多实例锁尚未完成；
- 正式 Drizzle 迁移文件需生成、审查并提交；
- PostgreSQL 容器集成测试尚未加入 CI。

## [0.1.0] - 2026-07-29

- 项目工程基线建立。
