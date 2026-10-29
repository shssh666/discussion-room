-- 代码审查插件指标库 crdb · v0.4 表结构
-- 部署：hermes 上的 PostgreSQL 17（docker compose，仅绑定 127.0.0.1）
-- 噪声四分类〔D2〕落在 findings.status；reviewer_version 记 prompt/工具/模型哈希

BEGIN;

CREATE TYPE finding_severity AS ENUM ('important','nit','pre_existing');
CREATE TYPE finding_status  AS ENUM ('posted','dropped_by_vote','fixed','wrong','intentional','ignored');
CREATE TYPE risk_tier       AS ENUM ('low','medium','high');
CREATE TYPE eval_verdict    AS ENUM ('caught','missed','false_positive');
CREATE TYPE layer_id        AS ENUM ('C1','C2','C2b','C3','C4','C5','C6','C7');

CREATE TABLE prs (
  id            bigserial PRIMARY KEY,
  repo          text NOT NULL,
  number        int  NOT NULL,
  author        text NOT NULL,
  agent_authored boolean NOT NULL DEFAULT false,
  risk_tier     risk_tier,
  lines         int,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  merged_at     timestamptz,
  reverted      boolean NOT NULL DEFAULT false,
  UNIQUE (repo, number)
);

CREATE TABLE review_runs (
  id              bigserial PRIMARY KEY,
  pr_id           bigint NOT NULL REFERENCES prs(id),
  reviewer_version text NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('quick','standard','deep')),
  round           int NOT NULL DEFAULT 1,
  ts              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE findings (
  id           bigserial PRIMARY KEY,
  run_id       bigint NOT NULL REFERENCES review_runs(id),
  path         text NOT NULL,
  line         int,
  severity     finding_severity NOT NULL,
  body         text NOT NULL,
  status       finding_status NOT NULL DEFAULT 'posted',
  status_updated_at timestamptz
);

CREATE TABLE approvals (
  id           bigserial PRIMARY KEY,
  pr_id        bigint NOT NULL REFERENCES prs(id),
  approver     text NOT NULL,
  is_bot       boolean NOT NULL DEFAULT false,  -- agent 批准永不占人工名额
  commit_sha   text NOT NULL,
  given_at     timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz                     -- 新 commit 进来时置非空 = 批准失效
);

CREATE TABLE incidents (
  id                     bigserial PRIMARY KEY,
  pr_id                  bigint REFERENCES prs(id),
  detected_at            timestamptz NOT NULL DEFAULT now(),
  detected_by            text NOT NULL,  -- telemetry / oncall / internal_use
  layer_should_have_caught layer_id,
  reverted               boolean NOT NULL DEFAULT true
);

CREATE TABLE eval_cases (
  id               bigserial PRIMARY KEY,
  source_incident  bigint REFERENCES incidents(id),
  repo             text NOT NULL,
  diff_ref         text NOT NULL,
  bug_location     text NOT NULL,
  confirmed_by     text NOT NULL,        -- 懂行工程师确认过才入集
  added_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eval_runs (
  id              bigserial PRIMARY KEY,
  reviewer_version text NOT NULL,
  case_id         bigint NOT NULL REFERENCES eval_cases(id),
  verdict         eval_verdict NOT NULL,
  ts              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON review_runs (pr_id);
CREATE INDEX ON findings (run_id);
CREATE INDEX ON findings (status);
CREATE INDEX ON approvals (pr_id);
CREATE INDEX ON eval_runs (reviewer_version, ts);

COMMIT;
