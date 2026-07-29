# ADR-0001：模块化单体优先

- 状态：Accepted
- 日期：2026-07-29

## 决策

使用pnpm Monorepo；Web、API、Worker独立进程；业务后端先保持模块化单体。

## 原因

两人团队无法合理承担微服务的部署、网络、分布式事务、追踪、服务发现和版本协同成本。模块化单体仍可通过清晰接口和领域事件未来拆分。

## 后果

- 代码评审阻止跨模块随意访问；
- Provider、Realtime、Settlement、Notification是优先拆分候选；
- 不因未来扩容提前部署Kubernetes或Kafka。
