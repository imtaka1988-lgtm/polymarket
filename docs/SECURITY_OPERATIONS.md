# 安全、运维与灾难恢复基线

## 1. 环境隔离

至少local、development、staging、production四套环境。数据库、密钥、域名和第三方配置相互隔离。生产数据不得复制到开发环境，除非完全匿名化。

## 2. 秘密管理

本地使用`.env`，云端使用Secrets Manager。密钥不进Git、定期轮换、最小权限、管理员MFA、生产访问审计。

## 3. 访问控制

权限和会员权益分离。角色示例：user、moderator、market_reviewer、support、operator、administrator。高风险操作要求二次确认、理由、审计和必要时双人审批。

## 4. 滥用防护

注册登录限流、CAPTCHA、设备和IP风险评分、服务端价格校验、幂等、临近结算封盘、多账号和延迟套利检测、管理员异常发币告警、排行榜异常剔除。

## 5. 备份

基线：PostgreSQL每日完整备份；关键账本更高频增量；跨区域；明确保留；季度恢复演练；备份加密和访问审计。

早期目标：核心账本RPO尽量接近分钟级，RTO数小时；Provider中断时停止新预测或只读。

## 6. 可观测性

监控API延迟错误率、数据库连接慢查询、Worker心跳、Provider同步延迟、WebSocket断线、Outbox积压、结算失败、账本不平、管理员高风险操作、备份结果和云成本。

M1 Provider 基线已将目录同步、生命周期、REST 校准、WebSocket、价格新鲜度和实时队列拆成独立
`provider_runtime_states`。连续失败、解析 Warning、陈旧价格、长时间断线和消息丢失写入
`provider_alerts`，恢复时标记 resolved 并保留历史。未来外部告警渠道必须从这些耐久状态转发，
不能只依赖单个 Worker 进程内存。

Provider degraded 时，V1 API 保留最后成功数据并返回 `readOnly=true`、公开状态代码和数据时间，
不得在请求链路中临时调用外部 Provider，也不得用空数据覆盖最后成功结果。公开响应不返回
`last_error`、告警 message/details 或 Provider 原始 payload。生产 API 数据库角色必须只授予
公开 read model 所需的 SELECT 权限。

API 负载均衡使用 `/api/v1/health/ready`，进程监管使用 `/api/v1/health/live`。数据库查询设置
statement timeout，防止慢查询长期耗尽连接池。`api_request_completed` 只记录 Request ID、方法、
无查询字符串路径、状态和耗时；不得记录 Cursor、Token、Cookie、Provider payload 或数据库凭据。

## 7. 事故等级

- SEV-1：数据损坏、账本错误、大范围不可用
- SEV-2：核心功能不可用但数据安全
- SEV-3：局部功能或性能问题
- SEV-4：轻微显示和文档问题

SEV-1优先停止进一步损害，不追求立即恢复全部功能。

## 8. 供应商退出

Polymarket、邮件、推送、AI、搜索和存储全部通过适配器。优先标准PostgreSQL、S3兼容接口、OAuth和容器化，减少锁定。
