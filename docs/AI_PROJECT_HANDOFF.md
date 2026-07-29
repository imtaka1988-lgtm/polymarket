# AI / 外部工程师项目接管说明

> 文档版本：V1.0  
> 最后更新：2026-07-29  
> 权威入口：根目录 `AGENTS.md`  
> 适用对象：新聊天窗口、ChatGPT Work、Codex、外部工程师、后续维护者

## 1. 这份文档解决什么问题

项目负责人不懂编程，项目主要由项目负责人与 AI/Codex 协作建设。任何新聊天、AI 或外部工程师都不能依赖过去的口头上下文，因此本仓库必须独立回答：

- 项目是什么；
- 为什么这样设计；
- 当前真正完成了什么；
- 哪些只是结构预留；
- 数据如何流动；
- 下一步应该做什么；
- 哪些做法被明确禁止；
- 出现未知 Bug 时如何收集证据和外援。

仓库文档和 GitHub Issues/PR/CI 是项目事实来源。聊天中的说法若与仓库冲突，以 `main` 分支和最新已合并 PR 为准。

## 2. 产品定义

项目工作名：**Event Forecast Lab**。

长期定位：

> 一个可接入多个外部事件与市场数据源的游戏化预测平台。用户使用免费、无现金价值的虚拟积分进行模拟预测，通过持仓、结算、排行榜、赛季、任务、成就和社交获得娱乐体验。

Polymarket 的角色：

- 首个事件目录 Provider；
- 首个市场概率和订单簿数据来源；
- 首个外部结算参考来源；
- 不是平台账户系统；
- 不是平台内部账本；
- 不是用户真实交易通道。

## 3. 永久产品边界

当前娱乐平台系统不得直接实现：

- 人民币、美元、加密货币充值提现；
- 可购买的预测筹码；
- 积分兑换现金、商品、礼品卡或其他有价物；
- 用户间转让或第三方回收积分；
- 钱包私钥托管；
- 真实 Polymarket 订单；
- 绕过地区限制、身份审查或平台规则；
- 私盘、对赌或未持牌资金结算。

若未来具备合法资质，真钱能力必须作为独立受监管系统，通过明确 API 与内容平台连接，不能直接把免费积分账本改成真钱账本。

## 4. 项目负责人的角色

项目负责人主要负责：

- 产品方向；
- 功能优先级；
- 页面和视觉验收；
- 业务规则确认；
- GitHub、云服务和域名账号控制；
- 密钥的最终保管；
- 决定是否公开上线。

AI/Codex/工程师负责：

- 需求转化；
- 架构和数据模型；
- 代码；
- 迁移；
- 自动测试；
- CI；
- 安全和故障处理；
- 文档同步；
- 外部求助材料。

原则：不要让项目负责人手工完成可以由自动化测试或 CI 完成的技术验收。

## 5. 当前技术架构

```text
浏览器
  ↓
Next.js Web (`apps/web`)
  ↓
NestJS API (`apps/api`)
  ↓
PostgreSQL + Redis
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
- Web、API、Worker 独立进程；
- PostgreSQL 是业务真相；
- Redis 用于缓存和未来任务；
- Transactional Outbox；
- Provider Adapter；
- 不可变虚拟积分账本；
- 结算版本和冲正；
- Feature Flags；
- 审计日志。

暂不采用：

- 完整微服务；
- Kafka；
- Kubernetes；
- 完整 Event Sourcing；
- 复杂多租户。

## 6. 仓库模块地图

### `apps/web`

用户前端。当前只具备工程基线，尚未完成正式市场列表、详情、账户和预测页面。

### `apps/api`

业务 API。当前主要有健康检查，未来承载身份、市场查询、报价、预测、账本、结算、排行榜和后台接口。

### `apps/worker`

当前负责 Polymarket Event Keyset 同步。未来增加：

- CLOB WebSocket；
- REST 行情对账；
- 关闭和结算回查；
- Outbox；
- 通知；
- 数据保留和降采样。

### `packages/provider-polymarket`

负责：

- Gamma 请求；
- `/events/keyset`；
- Cursor 分页；
- HTTP 错误分类；
- 超时、429/5xx 重试；
- 字段安全解析；
- Event/Market/Outcome 标准化；
- Query Signature；
- 同步编排。

业务模块不得直接依赖 Polymarket 原始字段。

### `packages/database`

负责：

- 用户和身份；
- Provider 原始数据；
- 本地统一市场；
- Outcome；
- 价格快照；
- Quote/Prediction；
- 双重记账；
- 结算；
- Outbox；
- 审计；
- Feature Flags；
- Provider 同步检查点、运行和原始页。

### `packages/domain`

统一市场状态、市场类型、Outcome、领域事件等，不包含外部 API 具体字段。

## 7. 当前核心数据流

### Event 目录同步

```text
Worker 定时触发
→ 根据固定查询条件生成 Query Signature
→ 从 PostgreSQL 读取对应 Cursor
→ GET /events/keyset
→ 验证 `{ events, next_cursor? }`
→ 保留整页原始 JSON
→ 安全解析字符串数组字段
→ 标准化 Event / Market / Outcome
→ 同一事务写入原始页、原始表、标准表和新 Cursor
→ 提交后才进入下一页
→ 写同步运行结果和结构化日志
```

关键不变量：

1. Cursor 不可解析或自行修改；
2. 不同 Query Signature 不共享 Cursor；
3. 页面数据和 Cursor 在同一事务提交；
4. 重复同步使用 Upsert 和 Page Key 去重；
5. `closed` 不等于本地已结算；
6. 解析失败保存原始值并产生 Warning，不虚构数据。

## 8. 当前已完成

以 `main` 最新合并状态为准：

- Monorepo、Web/API/Worker 边界；
- 核心领域和数据库结构；
- Polymarket `/events/keyset` 客户端；
- Cursor 和 Query Signature；
- 超时、指数退避、Retry-After；
- 安全字段解析；
- Event/Market/Outcome 标准化；
- PostgreSQL 同步检查点、运行和原始页结构；
- 每页原子提交的 Store 实现；
- Worker 单进程防重入；
- Provider 单元测试；
- CI 中测试、类型检查和构建；
- 完整施工、架构、Provider、排错和安全文档。

## 9. 当前未完成

### M1 数据闭环

- 正式数据库迁移和自动迁移验收；
- PostgreSQL 集成测试；
- 真实官方响应 Fixture；
- 多实例 Advisory Lock；
- CLOB WebSocket；
- REST 行情对账；
- 价格快照；
- 关闭和结算市场回查；
- Provider 监控、告警和管理后台；
- 用户端只读市场列表和详情。

### 后续产品闭环

- 用户注册；
- 免费虚拟积分；
- Quote；
- 模拟预测；
- 持仓；
- 结算和冲正；
- 排行榜；
- 任务、赛季、成就；
- 社交和私人房间；
- 会员和高级数据。

## 10. 当前里程碑

- M0 工程基线：完成；
- M1.1 Event Keyset 目录同步：完成基线；
- M1.2 数据库迁移和实机自动验收：当前工作；
- M1.3 实时行情：待开始；
- M1.4 回查、后台、只读页面：待开始；
- M2 模拟预测闭环：未开始。

打开 Issue #2 获取最细施工清单。不得仅根据本文件猜测最新进度。

## 11. 关键架构决策

读取 `docs/adr/`。当前必须遵守：

- 模块化单体优先；
- Provider 原始数据与业务模型隔离；
- Event 正式全量同步使用 Keyset，不使用 Offset；
- 账本使用不可变双重记账；
- 结算使用版本和冲正；
- 异步事件使用 Transactional Outbox；
- 文档和代码同 PR。

新的重大决策必须新增 ADR，不能只写在聊天中。

## 12. 强制开发流程

```text
读取 AGENTS 和当前状态
→ 查看 Issue 验收标准
→ 建分支
→ 确认影响模块和文档
→ 开发
→ 测试
→ 类型检查
→ 构建
→ 更新文档和 Changelog
→ Draft PR
→ CI 修正至全绿
→ 更新 Issue
→ 合并
→ 更新 CURRENT_STATE
```

禁止：

- 直接在 main 大量修改；
- 未更新文档就合并；
- 以手工点击代替可自动化测试；
- 关闭严格 TypeScript 来掩盖错误；
- 直接修改生产账本余额；
- 删除历史结算；
- 把秘密写入代码、Issue 或日志。

## 13. 新聊天加载协议

在新聊天或 Work 模式中，应给出仓库 URL并要求：

> 连接 GitHub 仓库 `imtaka1988-lgtm/polymarket`。先读取根目录 `AGENTS.md`，再按其中顺序读取全部权威文档、最新打开 Issue、最近合并 PR 和 CI。不要立即写代码。先汇报当前阶段、已完成、未完成、风险和建议下一步，然后继续 Issue #2。

AI 读取后应先确认：

- 当前 `main` Commit；
- 当前打开 Issue；
- 最近一次合并 PR；
- CI 是否全绿；
- 当前任务分支是否存在；
- 文档是否与代码一致。

## 14. 外部求助协议

外部工程师最少需要：

- 本文件；
- `docs/CURRENT_STATE.md`；
- 架构和 Provider 接入文档；
- 当前 Commit/PR/Issue；
- `pnpm support-bundle`；
- 脱敏日志；
- 复现步骤；
- 预期与实际结果；
- 数据库迁移状态。

禁止提供：

- `.env`；
- 数据库密码；
- Session Secret；
- Token、Cookie、私钥；
- 完整生产数据库；
- 用户个人信息。

## 15. 如何判断“完成”

功能必须同时满足：

- 代码存在；
- 自动测试覆盖关键路径；
- CI 全绿；
- 数据迁移存在；
- 回滚路径明确；
- 日志和故障证据可获取；
- 文档同步；
- Issue 验收项更新；
- 已知限制明确。

不能因为接口能返回数据或页面能打开就宣称生产完成。
