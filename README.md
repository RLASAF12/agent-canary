# AgentCanary 🐦

> Behavioral smoke tests for deployed AI agents — like a canary in the coal mine for your AI endpoints.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://rlasaf12.github.io/agent-canary)
[![Built with Supabase](https://img.shields.io/badge/backend-Supabase-3ECF8E)](https://supabase.com)
[![Edge Functions](https://img.shields.io/badge/runtime-Deno%20Edge-black)](https://deno.com)

## What it does

AgentCanary runs **scheduled behavioral probes** against your AI agent endpoints. Every 15 minutes it fires probe questions at your deployed agents, compares responses to expected keywords, and **alerts you the moment behavior drifts** — before your users notice.

```
┌─────────────┐    every 15 min    ┌───────────────────┐
│  pg_cron    │ ─────────────────► │  probe-runner     │
│ (scheduler) │                    │  (Deno Edge Fn)   │
└─────────────┘                    └─────────┬─────────┘
                                             │ POST probe questions
                                   ┌─────────▼─────────┐
                                   │  Your AI Agent    │
                                   │  endpoint_url     │
                                   └─────────┬─────────┘
                                             │ response
                                   ┌─────────▼─────────┐
                                   │  keyword check     │
                                   │  pass / drift /    │
                                   │  error             │
                                   └─────────┬─────────┘
                                             │
                                   ┌─────────▼─────────┐
                                   │  Supabase DB       │
                                   │  probe_runs +      │
                                   │  alerts table      │
                                   └───────────────────┘
```

## Why it exists

Silent AI agent failure is a real production problem:

- **52% accuracy decline** observed over 4 months in a published study of deployed LLMs
- A fintech team lost **12% conversion** before detecting drift in their chat agent
- Standard uptime monitors (200 OK) miss behavioral regressions entirely

AgentCanary closes that gap.

## Features

- 🔄 **Scheduled probing** — pg_cron fires Supabase Edge Function every 15 min
- 🔍 **Keyword baseline matching** — define expected keywords per probe question
- ⚠️ **Drift detection** — flags when responses stop containing expected patterns
- 🌐 **Live dashboard** — single HTML file, deployable to GitHub Pages
- 🔔 **Webhook alerts** — optional outbound webhook on drift/error
- 📊 **Pass rate tracking** — per-canary health metrics over time

## File structure

```
agent-canary/
├── index.html                  # Single-file dashboard (Tailwind + Supabase JS CDN)
├── supabase/
│   ├── migrations/
│   │   └── 20260612_initial_schema.sql   # Full DB schema
│   └── functions/
│       └── probe-runner/
│           └── index.ts                   # Deno Edge Function
└── README.md
```

## Quick start

### 1. Create a Supabase project

```bash
# Or use the Supabase dashboard at supabase.com
```

### 2. Apply the schema

Run `supabase/migrations/20260612_initial_schema.sql` in the SQL editor.

### 3. Deploy the Edge Function

```bash
supabase functions deploy probe-runner --no-verify-jwt
```

### 4. Add a canary

```sql
INSERT INTO canaries (name, endpoint_url) VALUES (
  'My GPT-4 Agent',
  'https://api.openai.com/v1/chat/completions'
);

INSERT INTO probe_questions (canary_id, question, baseline_keywords)
VALUES (
  '<canary-id>',
  'What is 2+2?',
  ARRAY['4', 'four']
);
```

### 5. Open the dashboard

Update the Supabase URL + anon key in `index.html`, then open in browser or deploy to GitHub Pages.

## Schema

| Table | Purpose |
|-------|---------|
| `canaries` | Agent endpoints to monitor |
| `probe_questions` | Questions + expected keywords per canary |
| `probe_runs` | Every probe result (pass/drift/error) |
| `alerts` | Drift/error events with optional webhook |

## Built by

[RLASAF12](https://github.com/RLASAF12) · Part of the ABC-TOM builder system.

