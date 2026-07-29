# 故障排查与外部求助

> 文档版本：V0.2  
> 最后更新：2026-07-29

## 1. 先保护数据，再找原因

生产严重故障顺序：关闭故障功能；必要时切只读；保存日志、请求 ID、时间和版本；回滚应用；禁止直接改账本或 Cursor；分析根因；通过正式修复和冲正恢复。

## 2. 标准问题记录

必须记录预期结果、实际结果、发生时间和时区、环境、影响范围、是否可复现、最近正常版本、最近发布/迁移/配置、Request ID、Run ID、Query Signature、市场 ID 或匿名用户 ID，以及已尝试方法。

## 3. 快速判断层级

### 页面打不开

运行 `pnpm health`，检查 Web 进程、浏览器控制台、网络端口、域名和 DNS。

### API 500

检查 Request ID、API 日志、数据库连接、环境变量、最近迁移和输入校验。不要公开完整堆栈和秘密。

### Worker 没有同步日志

确认 `pnpm dev` 中 Worker 进程启动，数据库迁移完成。

### `provider_sync_failed`

查看同一时间附近的 HTTP 状态、Request URL、Query Signature、Run ID 和错误类型，再检查 `provider_sync_runs` 与 `provider_sync_checkpoints`。

### 422：offset is not allowed

Keyset 不能使用 Offset。检查是否调用旧 `listEvents`、人工拼接 URL 或使用过期分支。

### 422：排序字段错误

临时设置：

```dotenv
POLYMARKET_SYNC_ORDER=id
```

重启 Worker。保存官方响应后更新代码、测试和文档，不要关闭响应验证。

### 503：keyset pagination is not configured

系统自动重试。连续失败后保留旧数据和 Cursor，不清库，不静默切换 Offset 写入。

### Cursor 不前进

系统停止以防死循环。提供 Request Cursor、Response Cursor、原始页 ID、Request URL 和 Run ID。不要手工随便修改 Cursor。

### 同一页重复

`provider_sync_pages.page_key` 防止同一内容重复插入，Event 和 Market 使用 Upsert。确认是正常重试还是 Query Signature 已改变。

### 数据库表不存在

```powershell
pnpm db:generate
pnpm db:migrate
```

确认 `DATABASE_URL` 指向正确环境。不要对生产库执行 `docker compose down -v`。

### Outcome 缺失或数量不一致

检查 `provider_sync_pages.raw_payload`、`outcomes`、`outcomePrices`、`clobTokenIds` 和解析 Warning。不要手工编造 Token ID 或价格。

### 市场价格不实时

当前 Gamma Keyset 只提供目录和初始参考。CLOB WebSocket 尚未完成，因此这不属于 Event 同步故障。

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

## 5. Provider 外部求助资料

提供：

- `docs/POLYMARKET_DATA_INTEGRATION.md`；
- 当前 Commit 和 PR；
- Run ID；
- Query Signature；
- Request/Response Cursor；
- Request URL；
- HTTP 状态和脱敏响应；
- Provider JSON 日志；
- 原始页 ID；
- test 和 verify 结果。

不要提供 `.env`、数据库密码、Token/Cookie、私钥、完整生产数据库或用户个人信息。

## 6. 向外部工程师求助

提供项目总企划、架构文档、Provider 规范、Support Bundle、Issue Report、复现步骤、脱敏日志、测试环境方式和 Git Commit/PR。

外部工程师改代码前应说明故障层、影响模块、数据风险、回滚方式，以及是否影响 Cursor、原始数据、账本或结算。

## 7. 已知问题库规则

每次解决有复用价值的问题，记录症状、根因、确认方法、临时处理、永久修复、预防、首次版本、修复版本、相关测试和文档。

目标不是硬猜，而是把未知问题变成外部工程师可以快速接手的标准材料。
