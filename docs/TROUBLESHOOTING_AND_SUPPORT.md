# 故障排查与外部求助

> 文档版本：V0.3  
> 最后更新：2026-07-29

## 1. 先保护数据，再找原因

生产严重故障顺序：关闭故障功能；必要时切只读；保存日志、Request ID、Run ID、时间、Commit 和版本；回滚应用；禁止直接改账本或 Cursor；分析根因；通过正式修复、迁移或冲正恢复。

## 2. 标准问题记录

必须记录：

- 预期结果；
- 实际结果；
- 发生时间和时区；
- 环境；
- 影响范围；
- 是否可复现；
- 最近正常 Commit；
- 最近 PR、迁移和配置；
- CI Run ID 和失败 Step；
- Request ID、Run ID、Query Signature；
- 市场 ID 或匿名用户 ID；
- 已尝试方法。

## 3. 快速判断层级

### 页面打不开

运行 `pnpm health`，检查 Web 进程、浏览器控制台、网络端口、域名和 DNS。

### API 500

检查 Request ID、API 日志、数据库连接、环境变量、最近迁移和输入校验。不要公开完整堆栈和秘密。

### CI：Schema 与迁移不同步

症状：`git diff --exit-code -- packages/database/drizzle` 失败。

处理：

1. 查看 Drizzle 生成差异；
2. 确认 Schema 改动是否有意；
3. 生成新迁移；
4. 审查 SQL 和 Snapshot；
5. 不要删除旧迁移或 Snapshot 来让 CI 变绿。

详细说明见 `docs/DATABASE_ACCEPTANCE.md`。

### CI：数据库迁移失败

检查：

- `packages/database/drizzle/`；
- Schema 与 Migration 顺序；
- Enum；
- Foreign Key；
- 表和索引重名；
- PostgreSQL 服务健康；
- `DATABASE_URL`。

不要使用 `drizzle-kit push` 绕过正式迁移。

### CI：原子回滚测试失败

这表示页面数据或 Cursor 可能已移到事务之外。立即检查 `PostgresEventsKeysetSyncStore.commitPage()`，不得降低断言或跳过测试。

### Worker 没有同步日志

确认 Worker 进程启动、数据库迁移完成、环境变量正确。

### `provider_sync_failed`

查看同一时间附近的 HTTP 状态、Request URL、Query Signature、Run ID 和错误类型，再检查 `provider_sync_runs` 与 `provider_sync_checkpoints`。

### `provider_sync_skipped`：`previous_run_still_active`

同一进程上一次同步尚未结束。检查同步耗时、API 响应、数据库性能和运行间隔。

### `provider_sync_skipped`：`distributed_lock_unavailable`

另一个 Worker 实例正持有同一 Query Signature 的 PostgreSQL Advisory Lock。短时间出现属于正常保护。

若长期持续：

1. 检查是否有旧 Worker 进程仍运行；
2. 检查数据库 Session；
3. 检查进程是否未正常执行 `finally`；
4. 不要手工改 Cursor；
5. 不要关闭分布式锁绕过问题。

### 422：offset is not allowed

Keyset 不能使用 Offset。检查是否调用旧 `listEvents`、人工拼接 URL 或使用过期分支。

### 422：排序字段错误

临时设置：

```dotenv
POLYMARKET_SYNC_ORDER=id
```

保存官方响应后更新代码、测试、文档和 ADR，不要关闭响应验证。

### 503：keyset pagination is not configured

系统自动重试。连续失败后保留旧数据和 Cursor，不清库，不静默切换 Offset 写入。

### Cursor 不前进

系统停止以防死循环。提供 Request Cursor、Response Cursor、原始页 ID、Request URL 和 Run ID。不要手工修改 Cursor。

### 同一页重复

`provider_sync_pages.page_key` 防止相同原始页重复插入，Event 和 Market 使用 Upsert。PostgreSQL 集成测试已验证重复执行幂等。

### 数据库表不存在

正常使用：

```powershell
pnpm db:migrate
```

只有修改 Schema 的工程师才运行 `pnpm db:generate`。确认 `DATABASE_URL` 指向正确环境。不要对生产库执行 `docker compose down -v`。

### Outcome 缺失或数量不一致

检查 `provider_sync_pages.raw_payload`、`outcomes`、`outcomePrices`、`clobTokenIds` 和解析 Warning。不要手工编造 Token ID 或价格。

### 市场价格不实时

当前 Gamma Keyset 只负责目录和初始参考。CLOB WebSocket 尚未完成，因此这不属于 Event 同步故障。

### 积分错误

立即暂停相关写操作，查询 ledger transaction 和 entries，检查幂等键和重复结算。禁止直接改余额，使用冲正。

### 结算卡住

- detected/reviewing：等待确认；
- calculating：计算任务；
- posting：账本写入；
- failed：查看错误和重试；
- completed：不得再次入账。

## 4. 自动工具

```bash
pnpm doctor
pnpm health
pnpm test
pnpm verify
pnpm support-bundle
```

Support Bundle 不复制 `.env` 或数据库。

## 5. 新聊天或外部工程师接管

首先提供：

- 根目录 `AGENTS.md`；
- `docs/AI_PROJECT_HANDOFF.md`；
- `docs/CURRENT_STATE.md`；
- 当前 Commit、PR、Issue 和 CI Run ID。

让接手者先读取仓库并汇报理解，不要直接给一段孤立错误让其猜测。

## 6. Provider/数据库外部求助资料

提供：

- `docs/POLYMARKET_DATA_INTEGRATION.md`；
- `docs/DATABASE_ACCEPTANCE.md`；
- 当前 Commit 和 PR；
- CI Run ID 和失败 Step；
- Run ID；
- Query Signature；
- Request/Response Cursor；
- Request URL；
- HTTP 状态和脱敏响应；
- Provider JSON 日志；
- 原始页 ID；
- 迁移文件和相关 Schema；
- test 和 verify 结果。

禁止提供 `.env`、数据库密码、Token/Cookie、私钥、完整生产数据库或用户个人信息。

## 7. 外部工程师修改前的要求

外部工程师应说明：

- 故障层；
- 影响模块；
- 数据风险；
- 回滚方式；
- 是否影响 Cursor、原始数据、Migration、Advisory Lock、账本或结算；
- 需要新增什么自动测试；
- 需要同步哪些文档。

## 8. 已知问题库规则

每次解决有复用价值的问题，记录症状、根因、确认方法、临时处理、永久修复、预防、首次版本、修复版本、相关测试、PR 和文档。

目标不是硬猜，而是把未知问题变成任何新聊天或外部工程师可以快速接手的标准材料。
