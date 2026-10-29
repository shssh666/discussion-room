# CLAUDE.md

## 这是什么

四人并发讨论室：左侧聊天、右侧演示区（图片/PDF/PPT 上传展示）、文件上传下载。
本仓同时是代码审查插件项目的试点仓——**每个功能一个 PR，全走审查流水线**，PR 编号路线见计划表。

## 栈

- Node.js 24 + TypeScript（strict）
- 后端：Fastify + ws（WebSocket）
- 前端：原生 TS，tsc 直出（无打包器；PR#1 起零原生依赖，适配 Android/CI）
- 数据库：PostgreSQL（hermes，与插件指标库同实例、独立库 `room`）
- 工具链：npm · node:test · eslint + prettier

## 约定

- 分层：`src/server`（后端）、`src/web`（前端）、`src/shared`（两端共用类型）；不跨层 import
- WebSocket 消息一律 JSON `{type, payload, ts}`，type 常量集中在 `src/shared/protocol.ts`
- 文件上传必须过服务端白名单 + 大小限制（前端限制只算体验，不算安全）
- 环境变量只经 `src/server/config.ts` 读取，禁止散落 `process.env`
- 服务器只有 1.9G 内存：上传/转换走流式，禁止整体读入内存

## 目标 / 非目标

- 目标：4 人稳定并发、演示翻页同步、文件安全收发
- 非目标：>4 人扩容、账号体系、移动端适配、长期消息历史

## 验证方式（提 PR 前必须跑，输出贴进 PR）

```
npm run lint && npm run typecheck && npm test && npm run build
```

涉及 WebSocket 的改动另跑 `npm run test:e2e` 并贴输出（PR#2 提供）。
