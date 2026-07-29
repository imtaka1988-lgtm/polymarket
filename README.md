# Event Forecast Lab

> **工作名称**：Event Forecast Lab  
> **项目形态**：娱乐型事件预测与游戏化互动平台  
> **当前阶段**：工程与文档基线 V0.1  
> **核心边界**：只使用无现金价值、不可购买、不可提现、不可转让的免费虚拟积分。

本项目以 Polymarket 的公开市场数据作为首个外部事件来源，但平台自身不依赖 Polymarket 的账户、钱包或交易系统。用户在本平台进行的是模拟预测，所有预测、积分、持仓与结算均记录在本地系统中。

## 现在已经具备的底座

- `apps/web`：Next.js 用户端
- `apps/api`：NestJS 业务 API
- `apps/worker`：异步任务、外部数据同步与结算 Worker
- `packages/domain`：统一领域模型和领域事件
- `packages/database`：PostgreSQL/Drizzle 数据模型
- `packages/provider-polymarket`：Polymarket Provider Adapter
- 不可变积分账本、结算版本、Outbox、审计、功能开关的数据结构
- 环境自检、项目验证、脱敏求助包脚本
- 从零搭建、架构、开发、排错、安全、运维和扩展路线文档

## 第一次开始

不懂编程时，不要直接修改代码。按以下顺序阅读：

1. [`docs/BEGINNER_BUILD_GUIDE.md`](docs/BEGINNER_BUILD_GUIDE.md)
2. [`docs/PROJECT_MASTER_PLAN.md`](docs/PROJECT_MASTER_PLAN.md)
3. [`docs/ARCHITECTURE_AND_DATA.md`](docs/ARCHITECTURE_AND_DATA.md)
4. [`docs/DEVELOPMENT_WORKFLOW.md`](docs/DEVELOPMENT_WORKFLOW.md)
5. [`docs/TROUBLESHOOTING_AND_SUPPORT.md`](docs/TROUBLESHOOTING_AND_SUPPORT.md)

## 本地快速启动

前提：Node.js 24 LTS、pnpm 11、Docker Desktop、Git。

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm doctor
pnpm dev
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
pnpm install
docker compose up -d
pnpm doctor
pnpm dev
```

默认地址：

- Web：http://localhost:3000
- API：http://localhost:4000/api/v1/health
- PostgreSQL：localhost:5432
- Redis：localhost:6379

## 常用命令

```bash
pnpm dev             # 启动全部开发服务
pnpm build           # 构建全部应用
pnpm typecheck       # TypeScript 类型检查
pnpm verify          # 发布前完整检查
pnpm doctor          # 环境自检
pnpm health          # 服务健康检查
pnpm support-bundle  # 生成脱敏外部求助包
```

## 安全底线

永远不要提交：

- `.env`
- 密码、Token、API Secret
- 钱包私钥或助记词
- 生产数据库
- 用户个人信息
- 未脱敏日志

详细规则见 [`SECURITY.md`](SECURITY.md)。

## 重要说明

这是工程基线，不是已完成产品。当前代码的目标是：

1. 让目录、边界和依赖关系一开始就正确；
2. 让任何一步都能自查；
3. 让未知故障可以形成标准求助材料；
4. 让后续社交、赛季、任务、会员、用户市场和移动端通过新增模块扩展；
5. 让真实资金或持牌业务永远作为独立受监管系统，而不是把免费积分账本直接改造成真钱账本。
