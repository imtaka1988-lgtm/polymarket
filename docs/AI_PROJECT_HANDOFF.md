# AI / 外部工程师项目接管说明

> 文档版本：V1.4
> 最后更新：2026-07-30
> 权威入口：根目录 `AGENTS.md`  
> 适用对象：新聊天窗口、ChatGPT Work、Codex、外部工程师、后续维护者

## 1. 使用方式

任何新聊天、AI 或外部工程师都不能依赖过去的口头上下文。进入仓库后必须：

1. 读取根目录 `AGENTS.md`；
2. 读取本文档；
3. 读取 `docs/CURRENT_STATE.md`；
4. 读取受当前任务影响的专项文档；
5. 查看打开的 GitHub Issues；
6. 查看最近合并 PR、当前分支和 CI；
7. 先汇报理解，再开始修改。

仓库 `main`、已合并 PR、打开的 Issue 和 CI 是事实来源。聊天内容与仓库冲突时，以仓库为准。

## 2. 产品定义

项目工作名：**Event Forecast Lab**。

长期定位：

> 一个可接入多个外部事件与市场数据源的游戏化预测平台。用户使用免费、无现金价值的虚拟积分进行模拟预测，通过持仓、结算、排行榜、赛季、任务、成就和社交获得娱乐体验。

Polymarket 的作用：

- 首个事件目录 Provider；
- 首个实时市场和订单簿数据来源；
- 首个外部结算参考；
- 不是平台账户系统；
- 不是平台内部账本；
- 不是用户真实交易通道。

## 3. 永久产品边界

当前娱乐平台系统不得直接实现：

- 法币或加密货币充值提现；
- 可购买的预测筹码；
- 积分兑换现金、商品、礼品卡或有价物；
- 用户间转让或第三方回收积分；
- 钱包私钥托管；
- 真实 Polymarket 订单；
- 绕过地区限制、身份审查或平台规则；
- 私盘、对赌或未持牌资金结算。

未来真钱能力必须作为独立受监管系统，不能直接把免费积分账本改造成真钱账本。

## 4. 项目负责人和技术执行者

项目负责人不懂编程，主要负责：

- 产品方向；
- 功能优先级；
- 页面和视觉验收；
- 业务规则确认；
- 账号、域名和密钥最终控制；
- 是否公开上线。

AI/Codex/工程师负责：

- 架构；
- 数据模型；
- 代码；
- 数据库迁移；
- 自动测试；
- CI；
- 故障定位；
- 文档同步；
- 外援材料。

原则：能由自动测试或 CI 完成的技术验收，不交给项目负责人手工判断。

## 5. 当前架构

```text
浏览器
  ↓
Next.js Web (`apps/web`)
  ↓
NestJS API (`apps/api`)
  ↓
PostgreSQL + Redis（预留基础设施）
  ↑
Worker (`apps/worker`)
  ↑
Provider Adapter (`packages/provider-polymarket`)
  ↑
Polymarket Gamma / CLOB / WebSocket
```

架构模式：

- pnpm Monorepo；
- 模块化单体；
- Web/API/Worker 独立进程；
- PostgreSQL 是业务真相；
- Redis 容器和环境变量已预留，当前 M1 读路径尚未使用；后续只能承担可重建缓存和任务能力；
- Provider Adapter；
- Transactional Outbox；
- 不可变双重记账；
- 结算版本和冲正；
- Feature Flags；
- 审计日志。

暂不采用完整微服务、Kafka、Kubernetes、完整 Event Sourcing 和复杂多租户。

## 6. 模块地图

### `apps/web`

Next.js 用户端。当前只有工程基线，正式市场列表、详情、账户和预测页面尚未完成。

### `apps/api`

NestJS API。当前已提供 V1 市场列表、详情、current price、Provider 数据状态、稳定 Cursor、
Request ID 和错误契约。API 只读本地 PostgreSQL，不在请求链路调用 Provider。未来承载身份、
报价、预测、账本、结算、排行榜和后台接口。

### `apps/worker`

当前负责 Polymarket Event Keyset 同步和 CLOB 实时价格数据闭环。已经具备：

- 进程内防重入；
- PostgreSQL Advisory Lock；
- Advisory Lock 与 Event Store 独立连接池；
- 失败页不推进 Checkpoint 累计计数；
- Cursor 恢复；
- 原子页面提交；
- 结构化日志。
- PostgreSQL Token Source；
- REST 启动快照和周期校准；
- WebSocket 有界串行写入队列；
- 不可变价格快照和 current price read model；
- 乱序保护和实时 Leader Lock。

生命周期回查、degraded 状态、耐久告警和版本化只读 API 已经完成。下一步是管理后台与只读页面；
Outbox、外部通知和数据保留策略留在后续运营阶段。
M1.5 读路径同时具备公开市场复合索引与正式迁移、2 万行查询计划和 Keyset 验收、
PostgreSQL statement timeout、liveness/readiness 分层，以及不记录查询字符串的结构化请求耗时日志。

### `packages/provider-polymarket`

负责 Gamma 请求、Keyset、Cursor、重试、安全解析、标准化、Query Signature、同步编排，
CLOB REST Order Book、Token Registry、Market WebSocket 生命周期和实时事件标准化。
业务模块不得直接依赖 Polymarket 原始字段。

### `packages/database`

负责用户、Provider 原始层、本地市场、Outcome、价格快照、Quote/Prediction、账本、结算、Outbox、审计、Feature Flags、同步检查点和正式迁移。

### `packages/domain`

负责统一市场状态、市场类型、Outcome 和领域事件，不包含外部 API 具体字段。

## 7. Event 目录数据流

```text
Worker 定时触发
→ 根据固定查询生成 Query Signature
→ 尝试获得 PostgreSQL Advisory Lock
→ 从 PostgreSQL 读取 Cursor
→ GET /events/keyset
→ 验证响应
→ 保留整页原始 JSON
→ 安全解析字符串数组
→ 标准化 Event / Market / Outcome
→ 同一事务写入原始页、原始表、标准表和 Cursor
→ COMMIT 后进入下一页
→ 记录 Run 和日志
→ finally 释放锁
```

关键不变量：

1. Cursor 是不透明令牌；
2. 不同 Query Signature 不共享 Cursor；
3. 页面数据和 Cursor 在同一事务；
4. 重复同步使用 Upsert 和 Page Key 去重；
5. `closed` 不等于本地已结算；
6. 解析失败保留原始值并产生 Warning；
7. 同一 Query Signature 同时只允许一个 Worker 实例运行。

## 8. 当前已完成

以 `main` 最新合并状态为准。PR #4、PR #5、PR #6、PR #7、PR #8、PR #9、PR #10 与 PR #11 合并后包括：

- Monorepo、Web/API/Worker 边界；
- 核心领域和数据库 Schema；
- 正式 Drizzle 初始迁移、Snapshot 和 Journal；
- CI PostgreSQL 16 服务；
- Schema/迁移漂移检查；
- CI 自动迁移；
- `/events/keyset`；
- Cursor 和 Query Signature；
- 超时、指数退避、Retry-After；
- 安全字段解析；
- Event/Market/Outcome 标准化；
- 同步检查点、运行和原始页；
- 页面与 Cursor 原子提交；
- 重复页面幂等；
- 故障整页回滚；
- 进程内防重入；
- PostgreSQL Advisory Lock；
- 单连接 Event Store 在持锁期间不自阻塞；
- 失败页面不会污染累计页数和累计事件数；
- Provider 单元测试；
- PostgreSQL Store 和 Lock 集成测试；
- CLOB Market WebSocket 官方契约和 ADR-0004；
- Token Registry、动态订阅和动态取消；
- `PING/PONG`、断线重连和完整重订阅；
- 实时消息标准化、生命周期指标和故障测试；
- REST 批量订单簿和周期校准；
- PostgreSQL Token Source、不可变快照和 current price read model；
- 来源事件幂等、逐字段乱序保护和十进制定点 midpoint；
- 实时 Worker Leader Lock 和有界串行消息队列；
- 正式价格迁移与 PostgreSQL 集成测试；
- Market 生命周期滚动回查、独立 Leader Lock 和官方契约解析；
- 不可变 Lifecycle Observation 与待人工复核 Resolution Candidate；
- 耐久 Provider Runtime State 和可恢复 Alert；
- 价格新鲜度、连续失败、断线、解析 Warning 和队列积压监控；
- 正式运营迁移与 PostgreSQL 恢复测试；
- V1 市场列表、详情、current price 与平台数据状态；
- 稳定 Keyset Cursor、十进制价格、Request ID 和错误代码；
- API 公开状态白名单、内部告警字段隔离和 PostgreSQL HTTP 集成测试；
- required database test fail-closed、Turbo 环境透传和 direct integration CI Step；
- 公开市场复合索引、正式迁移 0003 和大数据查询计划验收；
- API statement timeout、liveness/readiness 和结构化耗时日志；
- `docs/API_READ_CONTRACT.md` 和 ADR-0007；
- CI 测试、类型检查和生产构建；
- 根目录 `AGENTS.md` 和完整外援文档。

数据库证据和故障处理见 `docs/DATABASE_ACCEPTANCE.md`。

## 9. 当前未完成

### 下一施工阶段

- 管理后台和审核工作台；
- 用户端只读市场列表和详情；
- staging 真实网络长期恢复演练。

### M2 预测闭环

- 用户身份；
- 免费积分；
- Quote；
- Prediction/Position；
- Settlement；
- Ledger 业务服务；
- 排行榜。

## 10. 当前里程碑

- M0 工程基线：完成；
- M1.1 Event Keyset：完成基线；
- M1.2 数据库迁移与自动验收：完成；
- M1.3a CLOB WebSocket 客户端基础：完成；
- M1.3b Token Source、REST 对账与价格持久化：完成；
- M1.4 回查、降级与可观测性后端：完成；
- M1.5 版本化只读 API 与读路径可靠性：完成；
- M1.6 后台和只读页面：下一阶段；
- M2 模拟预测闭环：未开始。

精确进度以 Issue #2 和 `docs/CURRENT_STATE.md` 为准。

## 11. 关键文档

按任务读取：

- 总览：`docs/PROJECT_MASTER_PLAN.md`；
- 当前状态：`docs/CURRENT_STATE.md`；
- 架构：`docs/ARCHITECTURE_AND_DATA.md`；
- Polymarket：`docs/POLYMARKET_DATA_INTEGRATION.md`；
- 数据库：`docs/DATABASE_ACCEPTANCE.md`；
- API：`docs/API_READ_CONTRACT.md`；
- 施工：`docs/DEVELOPMENT_WORKFLOW.md`；
- 零基础：`docs/BEGINNER_BUILD_GUIDE.md`；
- 排错和外援：`docs/TROUBLESHOOTING_AND_SUPPORT.md`；
- 路线图：`docs/ROADMAP_CAPABILITY_MATRIX.md`；
- 决策：`docs/adr/`。

重大决策必须新增 ADR，不能只写在聊天中。

## 12. 强制流程

```text
读取 AGENTS 和当前状态
→ 查看 Issue 验收标准
→ 建分支
→ 确认影响模块与文档
→ 开发
→ 自动测试
→ 类型检查
→ 构建
→ 更新文档、Changelog、CURRENT_STATE 和 Issue
→ Draft PR
→ CI 修正至全绿
→ 合并
→ 核对 main、CI 和 Issue 最终状态
```

禁止：

- 直接在 main 大量修改；
- 文档未更新就合并；
- 手工点击替代可自动化测试；
- 放宽 TypeScript 掩盖错误；
- 直接修改生产账本余额；
- 删除历史结算；
- 提交秘密或生产数据。

## 13. 新聊天加载协议

新聊天或 Work 模式中发送：

> 连接 GitHub 仓库 `imtaka1988-lgtm/polymarket`。先读取根目录 `AGENTS.md`，再按顺序读取权威文档、最新打开 Issue、最近合并 PR 和 CI。不要立即写代码。先汇报当前阶段、已完成、未完成、风险和下一步，然后继续 Issue #2 的 M1.6 管理后台与只读页面。

读取后必须确认：

- 当前 main Commit；
- 打开的 Issue；
- 最近合并 PR；
- CI 是否全绿；
- 当前任务分支；
- 文档与代码是否一致。

## 14. 外部求助协议

提供：

- 本文档；
- `docs/CURRENT_STATE.md`；
- 受影响专项文档；
- 当前 Commit/PR/Issue；
- CI Run ID；
- `pnpm support-bundle`；
- 脱敏日志；
- 复现步骤和预期/实际结果。

禁止提供 `.env`、数据库密码、Token、Cookie、私钥、完整生产数据库或用户个人信息。

## 15. 完成定义

功能必须同时满足：

- 代码存在；
- 自动测试覆盖关键路径；
- CI 全绿；
- 数据库改动有迁移；
- 回滚路径明确；
- 日志和故障证据可获取；
- 文档、Changelog 和 Issue 同步；
- 已知限制明确。

接口能返回或页面能打开，不等于生产完成。
