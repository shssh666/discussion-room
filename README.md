# discussion-room

四人并发讨论室：左侧聊天交流，右侧演示区（图片/PDF/PPT 上传展示），支持文件上传下载。

**试点仓**：每个功能一个 PR，全走代码审查流水线（总体计划见 `../代码审查插件计划表.md`）。

- 项目约定：`CLAUDE.md` ／ 审查重点：`REVIEW.md`
- CI：`.github/workflows/ci.yml`（lint / typecheck / test / build 全绿才可合并）
- push 前钩子：`git config core.hooksPath .githooks`（lockfile 一致性预检；单独跑 `npm run check:lockfile`，实现见 `scripts/check-lockfile.mjs`）
- 数据库：`deploy/`（hermes 上的 PG，docker compose 起，仅绑定本机）
