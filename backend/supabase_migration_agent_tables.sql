-- Migration: Add ML and Agentic AI tables
-- Run this in Supabase SQL editor or as a new migration file.
-- File: supabase/migrations/20260210000000_agent_ml_tables.sql

-- ── Agent run tracking ─────────────────────────────────────────────────────────

CREATE TABLE public.agent_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brd_id      UUID REFERENCES public.brds(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'done', 'failed')),
  input       JSONB DEFAULT '{}'::jsonb,
  output      JSONB DEFAULT '{}'::jsonb,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Step-by-step agent trace (for the explainability UI)
CREATE TABLE public.agent_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_num    INTEGER NOT NULL DEFAULT 0,
  tool_name   TEXT NOT NULL,
  tool_input  JSONB DEFAULT '{}'::jsonb,
  tool_output JSONB DEFAULT '{}'::jsonb,
  thought     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ML model metadata registry
CREATE TABLE public.ml_models (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name    TEXT NOT NULL UNIQUE,
  model_type    TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  accuracy      NUMERIC(5,4),
  auc_roc       NUMERIC(5,4),
  trained_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  artifact_path TEXT,
  notes         TEXT
);

-- Enable RLS
ALTER TABLE public.agent_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_models   ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Project members can view agent runs" ON public.agent_runs
  FOR SELECT USING (
    project_id IS NULL
    OR public.is_project_member(auth.uid(), project_id)
  );

CREATE POLICY "Service role can manage agent runs" ON public.agent_runs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Project members can view agent steps" ON public.agent_steps
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.agent_runs ar
      WHERE ar.id = run_id
        AND public.is_project_member(auth.uid(), ar.project_id)
    )
  );

CREATE POLICY "Service role can manage agent steps" ON public.agent_steps
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can view ML models" ON public.ml_models
  FOR SELECT USING (auth.role() = 'authenticated');

-- Indexes for polling performance
CREATE INDEX idx_agent_runs_brd_id  ON public.agent_runs(brd_id);
CREATE INDEX idx_agent_runs_status  ON public.agent_runs(status);
CREATE INDEX idx_agent_steps_run_id ON public.agent_steps(run_id);

-- ── predictions table update: add unique constraint for upsert ─────────────────
-- (The delay predictor upserts on task_id + prediction_type)
ALTER TABLE public.predictions
  ADD CONSTRAINT predictions_task_type_unique UNIQUE (task_id, prediction_type);
