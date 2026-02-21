# SmartOps / ProjectIQ — Python ML + Agentic AI Backend

Complete backend for the ProjectIQ BRD generator platform.
Provides ML noise filtering, task delay prediction, and agentic BRD generation.

---

## Architecture

```
React Frontend (Lovable/Supabase)
    │
    ▼ HTTP (edge function → Python backend)
Supabase Edge Functions   ← existing, minimal changes
    │
    ▼ HTTP REST
Python FastAPI Backend    ← THIS REPO
    ├── /api/ml/*         — scikit-learn models
    ├── /api/agent/*      — Claude claude-sonnet-4-20250514 agentic BRD generation
    └── /api/integrations — Gmail, Slack, Fireflies live data
    │
    ▼
PostgreSQL (Supabase)     — existing tables + 3 new tables (agent_runs, agent_steps, ml_models)
```

---

## Quick Start

### 1. Clone and install

```bash
git clone <this-repo>
cd smartops-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your actual keys
```

Required:
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard → Settings → API
- `ANTHROPIC_API_KEY` — from console.anthropic.com

Optional (for live integrations):
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — for Gmail
- `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` — for Slack
- `FIREFLIES_API_KEY` — for Fireflies

### 3. Run the Supabase migration

```bash
# In Supabase SQL editor, paste and run:
supabase_migration_agent_tables.sql
```

### 4. Prepare ML training data

You need the datasets first:

**Enron Email Dataset:**
```bash
# Download from Kaggle: https://www.kaggle.com/datasets/wcukierski/enron-email-dataset
# Place emails.csv in data/raw/enron/emails.csv
```

**AMI Meeting Corpus:**
```bash
python3 preprocessing/download_ami.py
```

**Meeting Transcripts (Kaggle):**
```bash
# Download from: https://www.kaggle.com/datasets/robikscube/meeting-transcripts
# Place CSV files in data/raw/meetings/
```

### 5. Run preprocessing

```bash
python3 preprocessing/run_all.py
# This produces data/processed/all_sentences.csv (~200k sentences)
```

### 6. Train ML models

```bash
python3 training/run_all.py
# Trains: relevance classifier, intent classifier, delay predictor
# Models saved to data/processed/models/
# Runtime: ~5 minutes on CPU
```

### 7. Start the backend

```bash
uvicorn main:app --reload --port 8000
```

### 8. Connect to Supabase edge functions

Set the secret in your Supabase project:
```bash
supabase secrets set PYTHON_BACKEND_URL=https://your-deployed-backend.com
```

For local development (Supabase CLI):
```bash
supabase secrets set PYTHON_BACKEND_URL=http://host.docker.internal:8000
```

---

## API Reference

### ML Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ml/filter-sources` | Relevance classifier — removes noise from sources |
| POST | `/api/ml/classify-intent` | Intent classification per sentence |
| POST | `/api/ml/predict-delays` | Task delay risk scoring |

#### POST /api/ml/filter-sources
```json
{
  "sources": [
    {"type": "email", "content": "...", "metadata": {"subject": "..."}}
  ],
  "threshold": 0.3
}
```
Response:
```json
{
  "filtered_sources": [...],
  "total_input": 25,
  "total_relevant": 18,
  "noise_removed": 7
}
```

#### POST /api/ml/predict-delays
```json
{
  "project_id": "uuid",
  "tasks": [{"id": "uuid", "priority": "high", "deadline": "2026-03-01T00:00:00Z", ...}],
  "workload": {"user-uuid": 80.0},
  "history": {"user-uuid": {"overdue_rate": 0.15, "avg_completion_time": 32.5}}
}
```

### Agent Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/generate-brd` | Kick off async BRD agent |
| GET | `/api/agent/status/{run_id}` | Poll run status |
| POST | `/api/agent/nl-edit` | Natural language BRD editing |
| POST | `/api/agent/rewrite-text` | Text rewriting |

#### POST /api/agent/generate-brd
```json
{
  "brd_id": "uuid",
  "project_id": "uuid",
  "sources": [...],
  "project_context": "Mobile banking app for enterprise customers"
}
```
Response (immediate):
```json
{
  "run_id": "uuid",
  "status": "running",
  "brd_id": "uuid"
}
```

#### GET /api/agent/status/{run_id}
```json
{
  "id": "uuid",
  "status": "done",
  "output": {"success": true, "brd_id": "...", "conflicts": 2}
}
```

### Integration Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/integrations/gmail/auth?user_id=...` | Get Gmail OAuth URL |
| GET | `/api/integrations/gmail/callback` | OAuth callback |
| POST | `/api/integrations/gmail/fetch` | Fetch Gmail messages |
| GET | `/api/integrations/slack/auth?user_id=...` | Get Slack OAuth URL |
| GET | `/api/integrations/slack/callback` | OAuth callback |
| POST | `/api/integrations/slack/fetch` | Fetch Slack messages |
| GET | `/api/integrations/slack/channels?user_id=...` | List channels |
| POST | `/api/integrations/fireflies/fetch` | Fetch transcripts |
| GET | `/api/integrations/status/{user_id}` | All integration statuses |

---

## ML Models

### Relevance Classifier
- **Purpose:** Filter noise from emails/Slack/meetings before BRD extraction
- **Model:** TF-IDF (bigrams, 30k features) + Logistic Regression
- **Training data:** Enron + AMI + Meeting Transcripts (weak labels via keyword heuristics)
- **Target accuracy:** >85% on held-out test set
- **Saved to:** `data/processed/models/relevance_classifier.joblib`

### Intent Classifier
- **Purpose:** Classify each sentence as requirement | decision | action | timeline | stakeholder | noise
- **Model:** TF-IDF (trigrams, 50k features) + LinearSVC
- **Saved to:** `data/processed/models/intent_classifier.joblib`

### Delay Predictor
- **Purpose:** Predict task delay probability (0.0–1.0) for risk scoring
- **Model:** Gradient Boosting Classifier + Platt scaling (calibrated probabilities)
- **Features (9):** hours_to_deadline, priority, status, estimated_hours, dependency_depth, assignee_workload, overdue_rate, avg_completion_time, is_unassigned
- **Training:** Synthetic data bootstrapped from domain knowledge; improves automatically as real task_events accumulate
- **Saved to:** `data/processed/models/delay_predictor.joblib`

---

## Agentic BRD Generation — How It Works

1. **Frontend** calls Supabase edge function `process-brd` with sources
2. **Edge function** calls `/api/agent/generate-brd` → returns `run_id`
3. **BRD Agent** runs as a background task using Claude claude-sonnet-4-20250514 with tool_use:
   - `filter_noise` → calls `/api/ml/filter-sources` (ML relevance classifier)
   - `extract_brd` → calls `extract_requirements()` (Claude claude-sonnet-4-20250514)
   - `detect_conflicts` → keyword heuristic + Claude classification
   - `analyze_sentiment` → Claude sentiment analysis
   - `save_brd` → writes to Supabase
4. **Frontend** polls `/api/agent/status/{run_id}` until `status == "done"`
5. **BRD UI** loads the saved BRD from Supabase normally

Each step is logged to `agent_steps` table for full explainability.

---

## Deployment

### Railway (recommended for quick deploy)
```bash
# Install Railway CLI
npm install -g @railway/cli
railway init
railway up
railway domain  # get your public URL
```

### Docker
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Notes
- ML model files (`data/processed/models/*.joblib`) must be present at runtime
- Either commit the trained models to the repo or build/train in your CI pipeline
- The delay predictor is ~2MB, classifiers ~5MB each — fine to commit

---

## Improving the ML Models Over Time

The models start with synthetic/weak labels but improve automatically:

1. **More real data:** As tasks complete in Supabase, export `task_events` and re-train the delay predictor
2. **Human labels:** Add a `is_relevant` column in the Supabase UI and have analysts label edge cases
3. **Active learning:** The relevance classifier exposes `confidence` scores — low-confidence predictions can be surfaced for human review

To re-train with new data:
```bash
python3 training/run_all.py
# Restart the API server to reload the new models
uvicorn main:app --reload
```
