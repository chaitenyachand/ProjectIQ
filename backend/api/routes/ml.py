"""
api/routes/ml.py
ML API endpoints called by Supabase edge functions and the BRD agent.

Endpoints:
  POST /api/ml/filter-sources    — relevance classifier
  POST /api/ml/classify-intent   — intent classifier
  POST /api/ml/predict-delays    — delay risk scoring
"""

import logging
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class FilterSourcesRequest(BaseModel):
    sources: list[dict]
    threshold: float = 0.3


class ClassifyIntentRequest(BaseModel):
    texts: list[str]


class PredictDelayRequest(BaseModel):
    project_id: str
    tasks: list[dict]
    workload: dict = {}
    history: dict = {}


@router.post("/filter-sources")
async def filter_sources(req: FilterSourcesRequest, request: Request):
    """
    Run ML relevance classifier on input sources.
    Called by:
      - Supabase edge function filter-sources (replaces Lovable AI call)
      - BRD agent filter_noise tool
    """
    registry = request.app.state.models
    pipeline = registry.get("relevance")

    if pipeline is None:
        logger.warning("Relevance model not loaded — returning all sources as relevant")
        return {
            "filtered_sources": [
                {**s, "relevance_score": 1.0, "is_relevant": True}
                for s in req.sources
            ],
            "total_input": len(req.sources),
            "total_relevant": len(req.sources),
            "noise_removed": 0,
        }

    from ml.relevance_classifier import predict
    from ml.features import apply_source_weight, sort_sources_by_priority

    texts = [
        str(s.get("content", "") or "")[:2000]
        for s in req.sources
    ]
    predictions = predict(texts, pipeline)

    filtered = []
    needs_review = []   # 0.3–0.5 confidence — show warning badge in UI

    for source, pred in zip(req.sources, predictions):
        source_type = source.get("type", "email")

        # Apply source type priority weight (mentor suggestion #3)
        # Transcripts get boosted, Slack gets slight reduction
        weighted_score = apply_source_weight(pred["confidence"], source_type)

        # Transcripts always pass through regardless of ML score
        # because they are the richest source of requirements
        is_transcript = source_type.lower() == "transcript"

        if is_transcript or (pred["is_relevant"] == 1 and weighted_score >= req.threshold):
            filtered.append({
                **source,
                "relevance_score":  round(weighted_score, 3),
                "ml_confidence":    round(pred["confidence"], 3),
                "is_relevant":      True,
                "needs_review":     weighted_score < 0.5 and not is_transcript,
                "source_priority":  "high" if is_transcript else (
                    "medium" if source_type == "document" else "normal"
                ),
            })
        elif pred["confidence"] >= 0.25:
            # Low confidence but not zero — flag for user review
            needs_review.append({
                **source,
                "relevance_score": round(weighted_score, 3),
                "is_relevant":     False,
                "needs_review":    True,
            })

    # Sort: transcripts first, then by weighted score (mentor suggestion #3)
    filtered = sort_sources_by_priority(filtered)

    return {
        "filtered_sources": filtered,
        "needs_review":     needs_review,
        "total_input":      len(req.sources),
        "total_relevant":   len(filtered),
        "noise_removed":    len(req.sources) - len(filtered) - len(needs_review),
        "source_breakdown": {
            "transcripts": sum(1 for s in filtered if s.get("type") == "transcript"),
            "documents":   sum(1 for s in filtered if s.get("type") == "document"),
            "emails":      sum(1 for s in filtered if s.get("type") == "email"),
            "slack":       sum(1 for s in filtered if s.get("type") == "slack"),
        },
    }


@router.post("/classify-intent")
async def classify_intent(req: ClassifyIntentRequest, request: Request):
    """
    Classify the intent of each sentence.
    Returns requirement | decision | action | timeline | stakeholder | noise.
    """
    registry = request.app.state.models
    intent_model = registry.get("intent")

    if intent_model is None:
        raise HTTPException(503, "Intent model not loaded — run training/run_all.py")

    pipeline, le = intent_model
    from ml.intent_classifier import predict
    return {"results": predict(req.texts, pipeline, le)}


@router.post("/predict-delays")
async def predict_delays(req: PredictDelayRequest, request: Request):
    """
    Predict delay risk for a list of tasks.
    Writes results to Supabase tasks.delay_risk_score + predictions table.
    Called by:
      - Supabase edge function predict-delays (augments/replaces AI call)
      - Scheduled job (daily refresh)
    """
    registry = request.app.state.models
    model = registry.get("delay")

    if model is None:
        raise HTTPException(503, "Delay model not loaded — run training/run_all.py")

    from ml.delay_predictor import predict_batch
    from supabase import create_client

    results = predict_batch(
        tasks=req.tasks,
        model=model,
        workload=req.workload,
        history=req.history,
    )

    # Write back to Supabase
    try:
        sb = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )
        for r in results:
            sb.table("tasks").update(
                {"delay_risk_score": r["delay_probability"]}
            ).eq("id", r["task_id"]).execute()

            sb.table("predictions").upsert(
                {
                    "task_id":         r["task_id"],
                    "prediction_type": "delay_risk",
                    "probability":     r["delay_probability"],
                    "risk_level":      r["risk_level"],
                    "reasoning":       r["reasoning"],
                },
                on_conflict="task_id,prediction_type",
            ).execute()
    except Exception as e:
        logger.warning(f"Could not write predictions to Supabase: {e}")

    high_risk  = [r for r in results if r["risk_level"] == "high"]
    medium_risk = [r for r in results if r["risk_level"] == "medium"]

    return {
        "predictions":   results,
        "summary": {
            "total":       len(results),
            "high_risk":   len(high_risk),
            "medium_risk": len(medium_risk),
            "low_risk":    len(results) - len(high_risk) - len(medium_risk),
        },
    }
