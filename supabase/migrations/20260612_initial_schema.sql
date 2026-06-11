-- AgentCanary initial schema
-- Run in Supabase SQL editor or via CLI migrations

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

CREATE TABLE canaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  auth_header TEXT DEFAULT NULL,
  request_template JSONB DEFAULT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE probe_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canary_id UUID NOT NULL REFERENCES canaries(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  baseline_response TEXT DEFAULT NULL,
  baseline_keywords TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE probe_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canary_id UUID NOT NULL REFERENCES canaries(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES probe_questions(id) ON DELETE CASCADE,
  response TEXT DEFAULT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'drift', 'error')),
  drift_reason TEXT DEFAULT NULL,
  latency_ms INTEGER DEFAULT NULL,
  run_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canary_id UUID NOT NULL REFERENCES canaries(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES probe_runs(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  webhook_url TEXT DEFAULT NULL,
  sent_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_probe_runs_canary_id ON probe_runs(canary_id);
CREATE INDEX idx_probe_runs_run_at ON probe_runs(run_at DESC);
CREATE INDEX idx_alerts_canary_id ON alerts(canary_id);
CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);

-- Enable RLS
ALTER TABLE canaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE probe_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE probe_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- Demo mode: allow anon read/write (tighten for production)
CREATE POLICY "anon_all_canaries" ON canaries FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_probe_questions" ON probe_questions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_probe_runs" ON probe_runs FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_alerts" ON alerts FOR ALL TO anon USING (true) WITH CHECK (true);

-- Schedule probe-runner Edge Function every 15 minutes
SELECT cron.schedule(
  'run-agent-probes',
  '*/15 * * * *',
  $$SELECT net.http_post(
    url := 'https://<YOUR-PROJECT-ID>.supabase.co/functions/v1/probe-runner',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;$$
);
