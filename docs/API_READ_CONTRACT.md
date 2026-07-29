# 版本化只读 API 契约

> 文档版本：V1.0  
> 最后更新：2026-07-29  
> 适用代码：`@forecast/api` 0.2.x  
> 状态：M1.5 已实现

## 1. 目的和边界

前端只通过 `/api/v1` 读取本地标准化数据。API 请求链路不得调用 Polymarket，不返回
Provider 原始 payload、内部错误、告警详情、凭据或数据库内部字段。Provider 暂时失败时继续返回
最后成功保存的数据，并通过平台数据状态告诉客户端是否 degraded/read-only。

当前接口：

| 方法 | 路径                           | 用途                                  |
| ---- | ------------------------------ | ------------------------------------- |
| GET  | `/api/v1/health`               | API 进程存活检查                      |
| GET  | `/api/v1/markets`              | 市场列表和稳定 Cursor 分页            |
| GET  | `/api/v1/markets/{id}`         | 单个公开市场详情                      |
| GET  | `/api/v1/markets/{id}/prices`  | Outcome current price                 |
| GET  | `/api/v1/platform/data-status` | Provider 健康、公开告警代码和只读状态 |

## 2. 公开市场边界

公开状态只有：

- `open`
- `suspended`
- `closed`
- `resolving`
- `resolved`

`draft`、`pending_review`、`cancelled` 和 `archived` 不通过 V1 公开。详情和价格接口也执行相同
可见性检查，不允许通过猜测 UUID 绕过列表过滤。

列表默认 `status=open`、`limit=20`。`limit` 范围为 1–100。`status=all` 表示全部公开状态，
也可传唯一的逗号分隔子集，例如 `status=open,closed`。

## 3. 分页稳定性

市场按 `(updated_at DESC, id DESC)` 排序。Cursor 是不透明的 V1 Base64URL 值，内部保存最后一项的
排序元组。客户端必须原样回传，不能解析、修改或自行生成。

列表响应：

```json
{
  "data": [],
  "pagination": {
    "limit": 20,
    "hasNextPage": false,
    "nextCursor": null
  },
  "meta": {
    "apiVersion": "v1",
    "requestId": "c2e7...",
    "generatedAt": "2026-07-29T13:00:00.000Z"
  }
}
```

有下一页时 `nextCursor` 非空。无下一页时必须同时返回 `hasNextPage=false` 和
`nextCursor=null`。

## 4. 市场和价格字段

市场列表返回：

- 本地稳定 `id`
- `title`、`kind`、公开 `status`
- `opensAt`、`closesAt`、`resolvedAt`、`updatedAt`
- 精简 Provider 标识
- 排好序的 Outcomes 和 current price

详情额外返回 `rules` 和 `schemaVersion`。价格接口返回 `marketId`、Outcomes 和本次结果的
`asOf`。

所有概率和价格使用十进制字符串，例如 `"0.5000000000"`，避免 JavaScript 浮点损失。
缺少某项价格或时间时返回 `null`，绝不猜值。`latestSourceAt` 是该 Outcome 当前数据的最新来源时间；
`asOf` 是响应内所有 Outcome 的最大 `latestSourceAt`。

## 5. 平台数据状态

`/platform/data-status` 返回：

- `status`: `healthy`、`degraded` 或 `unavailable`
- `readOnly`: 只要不是 healthy 就为 `true`
- `lastSuccessfulAt`
- 各 Provider component 的公开健康字段
- 最多 100 个打开告警的 code、severity、component 和时间

未产生任何耐久运行状态时为 `unavailable`，不能假装 healthy。任一组件非 healthy 或存在打开告警时
为 `degraded`。公开接口不返回 `last_error`、告警 message 或 details。

前端在 `readOnly=true` 时可以继续展示最后成功数据和时间，但未来所有预测写操作必须禁用。

## 6. 错误和 Request ID

每个响应带 `x-request-id`。客户端提供的 Request ID 只有满足 1–128 位
`A-Z a-z 0-9 . _ -` 时才沿用，否则服务端生成 UUID。

稳定错误体：

```json
{
  "error": {
    "code": "INVALID_CURSOR",
    "message": "cursor is not a valid v1 market cursor"
  },
  "meta": {
    "apiVersion": "v1",
    "requestId": "c2e7...",
    "generatedAt": "2026-07-29T13:00:00.000Z"
  }
}
```

V1 当前稳定错误代码：

- `INVALID_LIMIT`
- `INVALID_STATUS`
- `INVALID_CURSOR`
- `INVALID_ID`
- `DUPLICATE_QUERY_PARAMETER`
- `MARKET_NOT_FOUND`
- `ROUTE_NOT_FOUND`
- `INTERNAL_ERROR`

未知服务端错误只返回通用信息，完整错误与相同 Request ID 记录在服务端结构化日志。

## 7. 运行配置

- `API_PORT`：默认 4000
- `API_DATABASE_POOL_MAX`：默认 10，必须为正整数
- `API_CORS_ORIGINS`：允许的前端 Origin，逗号分隔；本地默认 `http://localhost:3000`
- `DATABASE_URL`：API 只读查询使用的 PostgreSQL

生产环境应给 API 使用数据库只读角色。CORS 只允许 GET、HEAD、OPTIONS，不携带 Cookie。

## 8. 自动验收

自动测试验证：

- Cursor 往返、边界和非法输入；
- 默认公开状态和分页大小；
- `(updated_at,id)` 跨页不重不漏；
- draft 市场不能从 `status=all` 泄漏；
- 详情与价格的字段、十进制精度和来源时间；
- 稳定错误体和 Request ID；
- healthy/degraded/readOnly 转换；
- 内部告警 message/details 不出现在公开响应；
- API、Worker PostgreSQL 测试跨包串行，避免测试清理互相污染。
- CI 以 `REQUIRE_TEST_DATABASE=true` 强制数据库 URL 存在，并绕过 Turbo 再直接执行集成测试；
  任何 SKIP 都不能作为 PostgreSQL 验收证据。

完整 PostgreSQL HTTP 验收在 GitHub Actions 的 PostgreSQL 16 服务中执行。
