# Contributing

## 核心原则

1. 不在 `main` 直接开发。
2. 一项任务一个分支，格式：`agent/<说明>` 或 `feature/<说明>`。
3. 功能必须同时提交代码、测试和文档。
4. 账本历史不能删除；错误通过冲正处理。
5. 生产数据不能直接用 SQL 手工修正。
6. 外部 API 原始结构只能存在于 Provider Adapter 内。
7. 业务规则不能写死在页面组件中。
8. 未通过 `pnpm verify` 不得发布。

## 标准流程

```text
需求与验收标准
→ 架构影响检查
→ 创建分支
→ 开发
→ 本地自检
→ 测试
→ 更新文档
→ Pull Request
→ Staging验收
→ 合并
→ 发布
```

详细流程见 `docs/DEVELOPMENT_WORKFLOW.md`。
