# 当前项目状态快照

> 状态日期：2026-07-29  
> 项目阶段：M1 Provider 数据闭环  
> 当前工作：M1.2 数据库迁移与自动验收  
> 权威任务：GitHub Issue #2  
> 状态规则：本文件每次功能 PR 必须更新

## 1. 已合并基线

- PR #1：工程、架构、文档、自检与 CI 基线；
- PR #3：Polymarket Events Keyset 可恢复同步。

## 2. 当前已经具备

- Next.js Web、NestJS API、Worker 独立应用；
- PostgreSQL/Drizzle 数据结构；
- Provider Adapter；
- `/events/keyset`；
- Cursor 检查点和 Query Signature；
- 超时、429/5xx 重试和指数退避；
- Event/Market/Outcome 安全解析与标准化；
- 原始页、同步运行和检查点持久化结构；
- 同一事务提交页面数据和 Cursor；
- 单进程防重入；
- Provider 自动测试；
- CI 测试、类型检查和构建；
- 零基础施工、外援、排错和架构文档。

## 3. 当前正在完成

- 正式数据库迁移文件；
- GitHub Actions PostgreSQL 服务；
- 迁移自动执行；
- PostgreSQL 集成测试；
- 重复同步、Cursor 恢复和事务回滚验收；
- AI/工程师可独立接管的仓库入口。

## 4. 尚未完成

### M1.3 实时行情

- CLOB WebSocket；
- 动态 Token 订阅；
- 断线重连和重新订阅；
- REST 初始快照和定时对账；
- 价格快照和延迟指标。

### M1.4 回查和运营

- 关闭/结算滚动回查；
- degraded/只读模式；
- 同步告警；
- 同步管理后台；
- 只读市场列表和详情页面。

### M2 预测闭环

- 身份；
- 免费积分；
- Quote；
- Prediction；
- Position；
- Settlement；
- Ledger 业务实现。

## 5. 当前已知风险

- Keyset 推荐排序 `updatedAt,id` 仍需要真实官方长期契约验证；
- 当前主分支尚未具备 CLOB 实时行情；
- 多 Worker 实例前必须增加 PostgreSQL Advisory Lock；
- 外部字段可能变化，必须保存原始响应并维护 Fixture；
- 不能把 `closed` 直接解释为本地已结算；
- 当前不是可公开运营的成品。

## 6. 完成度口径

截至 PR #3 合并后的评估：

- Event Keyset 目录同步模块：约 87%；
- 整个 M1 数据闭环：约 43%；
- 整个成熟平台：仍处于早期基础阶段。

M1.2 自动迁移和 PostgreSQL 集成测试通过后，需重新计算并更新这里。

## 7. 新接手者下一步

1. 读取根目录 `AGENTS.md`；
2. 读取 `docs/AI_PROJECT_HANDOFF.md`；
3. 查看 Issue #2；
4. 检查当前分支和 PR；
5. 检查 GitHub Actions；
6. 继续 M1.2，不要跳到用户预测或页面装饰。
