# 故障排查与外部求助

> 文档版本：V0.4
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

锁连接和 Event Store 连接必须来自两个独立 Pool。`WORKER_DATABASE_POOL_SIZE` 只控制
Store Pool；即使设置为 1，也不应因为 Advisory Lock 占用连接而永久等待。
若单实例在获得锁后没有任何页面提交日志，检查 `apps/worker/src/index.ts` 是否错误地把
Store Pool 传给 `tryAcquirePostgresAdvisoryLock()`。

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

### 失败后累计页数或事件数异常增加

失败页面不能进入累计计数。检查同步编排器是否在 `commitPage()` 成功前增加
`pagesProcessed` 或 `eventsProcessed`，并运行 Provider 失败页回归测试。
不要手工修正 Cursor；先确认最后成功页面和 Checkpoint，再通过正式修复恢复统计。

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

Gamma Keyset 只负责目录和 Token ID；正式价格来自 CLOB REST/WebSocket 闭环。依次检查：

1. `POLYMARKET_REALTIME_ENABLED` 是否为 `true`；
2. 数据库是否已执行 `0001_silly_siren.sql`；
3. `markets.status` 是否为 `open`，Outcome 是否有 `provider_token_id`；
4. 是否只有一个实例记录 `market_realtime_started`，其他实例等待实时 Leader Lock；
5. REST `/books` 校准是否成功，WebSocket 是否已订阅；
6. `market_price_snapshots` 是否继续增加；
7. `market_current_prices` 的字段 captured time 是否前进；
8. Provider 是否连续 429/5xx 或网络是否阻止 WSS。

不要用 Gamma 目录价格覆盖 current read model，也不要删除快照或手工修改字段时间。

### 有历史快照但 current 价格不更新

先比较该快照 `captured_at` 与 current 对应字段的 captured time。旧事件会保存为历史证据，
但按设计不会覆盖更新字段。若新事件仍不能更新，检查 Token 映射是否歧义、价格是否超出
`0..1`、来源时间是否缺失，以及事务日志中的 Store 错误。

### `market_websocket_event_dropped`

有界队列已达到 `POLYMARKET_WEBSOCKET_MAX_QUEUE_SIZE`。系统会丢弃新增消息并等待 REST 周期校准恢复。
检查数据库写入延迟、连接池、消息突发和队列高水位。不要把队列改成无界；可在验证容量后小幅
提高上限，并优先修复持续的数据库慢写。

### 实时 Leader 反复切换

检查专用 Lock Pool 的数据库连接、网络中断和 `market_realtime_lock_health_check_failed`。
实时锁必须使用独立 Session，不能复用 Store Pool。Session 失效时当前实例应先停止
WebSocket/REST，再重新竞选；不要关闭锁或让每个副本都连接行情。

### Market WebSocket 没有建立连接

客户端只有在已启动且 Token Registry 非空时才连接。依次检查：

1. Registry 是否有有效 Token ID；
2. 地址是否为 `wss://ws-subscriptions-clob.polymarket.com/ws/market`；
3. 是否把公开 Market Channel 错写成需要凭据的 User Channel；
4. `connectionAttempts`、当前 state 和 Warning；
5. 网络是否允许 WSS。

不要为了建立公开行情连接而填写 API Key、Secret、Passphrase 或钱包私钥。

### Market WebSocket 反复断线

检查是否每 10 秒发送文本 `PING`、是否收到 `PONG`、订阅帧是否使用 `assets_ids`，
以及重连后是否从 Registry 完整重订阅。保留状态变化、重连次数、最后消息时间和脱敏 Warning。
不要关闭指数退避形成高频重连。

### WebSocket 出现未知或非法消息

Provider Parser 会记录 Warning 并跳过缺少关键标识的消息。保存脱敏 Fixture、事件类型和时间，
更新契约测试后再扩展解析器；不要把外部 snake_case 原始对象直接传给业务模块。

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
