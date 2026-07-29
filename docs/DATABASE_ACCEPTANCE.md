# 数据库迁移与自动验收规范

> 文档版本：V1.1
> 最后更新：2026-07-29  
> 适用阶段：M1.2 及以后所有数据库改动  
> 状态：已由 GitHub Actions 验证

## 1. 目的

本项目负责人不懂编程，因此数据库正确性不能依赖项目负责人手工执行和判断。本规范把数据库迁移、结构一致性、事务、幂等、Cursor 恢复和多实例锁全部纳入自动 CI。

任何数据库相关 PR 必须同时提交：

- Drizzle Schema 变更；
- 正式迁移文件；
- 集成测试；
- 文档；
- Changelog；
- Issue 验收状态。

缺少任何一项，视为未完成。

## 2. 正式迁移位置

```text
packages/database/drizzle/
├── 0000_initial_platform.sql
├── 0001_silly_siren.sql
└── meta/
    ├── 0000_snapshot.json
    ├── 0001_snapshot.json
    └── _journal.json
```

初始迁移由 `drizzle-kit generate` 根据以下 Schema 自动生成：

```text
packages/database/src/schema.ts
packages/database/src/provider-sync-schema.ts
```

迁移不是人工猜写。CI 会重新执行 `pnpm db:generate`，若生成结果会修改已提交迁移，`git diff --exit-code` 会失败。

## 3. CI 数据库环境

GitHub Actions 在每次 PR 和 main Push 时启动独立 PostgreSQL 16 容器：

```text
数据库：forecast_test
用户：forecast
端口：5432
```

仅用于 CI，不包含生产数据。

CI 顺序：

```text
安装依赖
→ 根据 Schema 检查迁移是否同步
→ 执行 pnpm db:migrate
→ 运行 PostgreSQL 集成测试
→ TypeScript 严格类型检查
→ 生产构建
```

任一步失败，PR 不得合并。

## 4. 自动测试位置

```text
apps/worker/src/postgres-events-sync-store.integration.test.ts
apps/worker/src/postgres-advisory-lock.integration.test.ts
apps/worker/src/postgres-market-price-store.integration.test.ts
```

### Store 集成测试验证

- 迁移创建同步所需表；
- 一页原始数据、标准化数据和 Cursor 能够成功提交；
- Checkpoint 可以恢复下一 Cursor；
- Run 状态可以更新为 partial/completed；
- 同一页重复执行不会产生重复原始页、Event、Market 或 Outcome；
- 持久化中途失败时，原始页、Event、Market、Outcome 和 Cursor 全部回滚。
- 失败页不会进入 Checkpoint 的累计页数和累计事件数。

### Advisory Lock 集成测试验证

- 第一个 Worker 会话可以获得指定 Query Signature 的锁；
- 第二个 Worker 会话不能同时获得同一锁；
- 第一个会话释放后，第二个会话可以获得锁。
- Advisory Lock 和 Event Store 使用不同连接池；
- Event Store Pool 大小为 1 时，持锁期间仍能完成完整同步。

### Market Price Store 集成测试验证

- 只有 `open` 市场且存在 Provider Token ID 的 Outcome 会进入实时订阅；
- 相同来源事件键重复提交不会产生重复价格快照；
- 未知 Token 不会创建孤立快照；
- 新事件只更新自身携带的价格字段，不会清空其他字段；
- 乱序旧事件保留不可变历史证据，但不会回退 current 价格或字段时间；
- 快照和 `market_current_prices` 在同一个事务中提交。

## 5. 原子事务不变量

`PostgresEventsKeysetSyncStore.commitPage()` 必须在同一个事务中处理：

1. `provider_sync_pages`；
2. `provider_events`；
3. `provider_markets`；
4. `markets`；
5. `market_outcomes`；
6. `provider_sync_checkpoints`。

只有全部成功才 `COMMIT`。任一步失败必须 `ROLLBACK`。
同步编排器只有在 `commitPage()` 成功返回后，才增加累计页数、累计事件数和 Warning 数量。

禁止：

- 先更新 Cursor 再保存页面；
- 捕获 SQL 错误后继续提交；
- 用手工 SQL 补写缺失 Cursor；
- 删除原始页掩盖同步错误。

价格写入也必须保持一条事务边界：先按 Provider Token 唯一解析本地
Market/Outcome，再幂等写入 `market_price_snapshots`，最后按字段来源时间 Upsert
`market_current_prices`。Token 缺失或映射歧义时不得写入孤立价格。

## 6. 幂等规则

- Event：`provider + provider_event_id` 唯一；
- Market：`provider + provider_market_id` 唯一；
- Outcome：`market_id + sort_order` 唯一；
- 原始页：SHA-256 `page_key` 唯一；
- Checkpoint：`provider + resource_type + query_signature` 唯一。
- Price Snapshot：`source_event_key` 唯一；
- Current Price：`outcome_id` 唯一。

重复同步允许更新内容，但不能增加重复身份记录。

## 7. 多实例锁

Worker 同时使用两层保护：

1. 进程内 `running` 标志：防止同一进程定时器重入；
2. PostgreSQL Advisory Lock：防止多个 Worker 实例同时同步同一 Query Signature。

锁名直接使用稳定 Query Signature：

```text
polymarket:events-keyset:v1:{固定查询条件}
```

锁是 PostgreSQL Session 级锁。获得锁的连接必须保持到同步结束，并在 `finally` 中释放。
锁连接来自独立的单连接 Pool，不能从 Event Store 的业务 Pool 借用。业务 Pool 可以配置为 1，
仍必须能在持锁期间获得自己的数据库连接并完成同步。

如果另一个实例已持锁，Worker 记录：

```text
provider_sync_skipped
reason=distributed_lock_unavailable
```

它不会启动第二条同步链，也不会修改 Cursor。

实时行情使用第二个稳定 Session Lock：

```text
polymarket:market-realtime:v1
```

只有实时 Leader 执行 REST `/books` 校准、Market WebSocket 订阅和价格持久化。
它也使用独立单连接 Pool，并通过健康检查确认锁 Session 仍可用；失去 Session 后必须停止
实时处理并重新竞选，不得让多个实例同时写同一条实时数据流。

## 8. 本地命令

项目负责人通常不需要执行技术验收。工程师或 AI 调试时可使用：

```powershell
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm --filter @forecast/worker test:integration
pnpm verify
```

本地没有 `TEST_DATABASE_URL` 时，数据库集成测试会跳过；CI 中该变量是必填并真实运行。

## 9. 数据库变更流程

```text
修改 Schema
→ pnpm db:generate
→ 审查 SQL 和 Snapshot
→ 提交迁移
→ 添加或更新集成测试
→ 更新专项文档
→ PR
→ CI 验证迁移无漂移
→ CI 执行迁移和测试
→ 合并
```

不允许：

- 只改数据库不提交迁移；
- 只提交 SQL 不更新 Schema；
- 生产环境使用 `drizzle-kit push` 代替正式迁移；
- 直接修改已在生产执行过的历史迁移。

历史迁移有错误时，应新增修复迁移。

## 10. CI 失败排查

### Schema 与迁移不同步

症状：`git diff --exit-code -- packages/database/drizzle` 失败。

处理：

1. 查看 Drizzle 生成差异；
2. 确认 Schema 改动是否有意；
3. 生成新迁移；
4. 不要手工删除 Snapshot 差异。

### 迁移失败

检查：

- SQL 语句；
- Enum 顺序；
- Foreign Key 依赖顺序；
- 表或索引重名；
- DATABASE_URL；
- PostgreSQL 服务健康状态。

### 原子回滚测试失败

立即检查 `commitPage()` 是否有 SQL 移到事务之外。不要降低测试断言。

### Advisory Lock 测试失败

检查：

- 是否使用同一个 Session 持锁和释放；
- 是否在锁获得后过早释放 PoolClient；
- 锁名是否与 Query Signature 一致；
- `finally` 是否始终释放。
- 锁是否错误复用了 Event Store Pool；
- 单连接 Store 完整同步测试是否被跳过或超时。

### 实时价格测试失败

检查：

- `provider_markets.provider_token_id` 是否唯一映射到本地 Outcome；
- 事件是否携带官方来源时间和稳定 `source_event_key`；
- `market_price_snapshots` 与 `market_current_prices` 是否在同一事务中；
- 字段级 captured time 条件是否阻止旧事件覆盖新价格；
- REST `/books` 是否在 WebSocket 启动前完成一次校准。

## 11. 外部求助资料

提供：

- 当前 Commit 和 PR；
- CI Run ID；
- 失败 Step；
- 迁移文件；
- 相关 Schema；
- 脱敏日志；
- `docs/DATABASE_ACCEPTANCE.md`；
- `docs/POLYMARKET_DATA_INTEGRATION.md`。

禁止提供数据库密码、`.env` 或完整生产数据库。

## 12. 当前验收结果

PR #4 与 PR #5 的 PostgreSQL CI 已验证：

- Schema 与正式迁移同步；
- 初始迁移执行成功；
- 所需数据表存在；
- 页面与 Cursor 原子提交；
- Cursor 可恢复；
- 重复页面幂等；
- 故障整页回滚；
- 失败页不污染 Checkpoint 累计计数；
- 多实例 Advisory Lock 互斥、释放和连接池隔离；
- Store Pool 大小为 1 时完整同步不自阻塞；
- `pnpm-lock.yaml` 冻结依赖安装；
- 自动测试通过；
- TypeScript 类型检查通过；
- 生产构建通过。
