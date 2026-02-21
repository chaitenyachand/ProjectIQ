-- Migration: Mentor suggestions — Jira sync columns + integration_accounts update
-- File: supabase/migrations/20260215000000_mentor_suggestions.sql
-- Run in Supabase SQL editor

-- ── 1. Add Jira columns to tasks table ────────────────────────────────────────
-- Stores the Jira issue key and URL after tasks are synced

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS jira_issue_key TEXT,
  ADD COLUMN IF NOT EXISTS jira_issue_url TEXT;

-- Index for looking up tasks by Jira key (useful for webhook callbacks)
CREATE INDEX IF NOT EXISTS idx_tasks_jira_key
  ON public.tasks(jira_issue_key)
  WHERE jira_issue_key IS NOT NULL;


-- ── 2. Allow "jira" as a valid provider in integration_accounts ───────────────
-- The original migration only allows gmail | slack | fireflies

ALTER TABLE public.integration_accounts
  DROP CONSTRAINT IF EXISTS integration_accounts_provider_check;

ALTER TABLE public.integration_accounts
  ADD CONSTRAINT integration_accounts_provider_check
  CHECK (provider IN ('gmail', 'slack', 'fireflies', 'jira', 'linear', 'trello'));


-- ── 3. Add citation_verified tracking to BRDs ─────────────────────────────────
-- Stores the anti-hallucination check results from extract_tool.py

ALTER TABLE public.brds
  ADD COLUMN IF NOT EXISTS has_unverified_citations BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS unverified_citation_count INTEGER DEFAULT 0;


-- ── 4. Add source_priority column to track which source type dominated ─────────
ALTER TABLE public.brds
  ADD COLUMN IF NOT EXISTS primary_source_type TEXT
    CHECK (primary_source_type IN ('transcript', 'document', 'email', 'slack', 'mixed'));
