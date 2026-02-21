"""
ml/delay_predictor.py
Predicts task delay probability (0.0–1.0).

Model:    GradientBoostingClassifier + Platt scaling (calibrated probabilities)
Training: Synthetic data bootstrapped from domain knowledge.
          Automatically improves as real task_events accumulate in Supabase.

Features (9):
  hours_to_deadline, priority_encoded, status_encoded, estimated_hours,
  dependency_depth, assignee_workload_hours, assignee_overdue_rate,
  assignee_avg_completion_hours, is_unassigned
"""

import logging
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split

from ml.features import task_feature_vector, FEATURE_NAMES

logger = logging.getLogger(__name__)

MODEL_PATH = Path("data/processed/models/delay_predictor.joblib")


def build_model() -> CalibratedClassifierCV:
    base = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        random_state=42,
    )
    return CalibratedClassifierCV(base, cv=3, method="sigmoid")


def generate_synthetic_data(n: int = 6000) -> pd.DataFrame:
    """
    Synthetic training data based on domain rules.
    Replace or augment with real task_events data once you have enough history.
    """
    rng = np.random.default_rng(42)

    hours_to_deadline = rng.uniform(-48, 500, n)
    priority_encoded  = rng.integers(0, 4, n)
    status_encoded    = rng.integers(0, 4, n)
    estimated_hours   = rng.uniform(1, 80, n)
    dependency_depth  = rng.integers(0, 6, n)
    workload          = rng.uniform(0, 200, n)
    overdue_rate      = rng.beta(2, 8, n)
    avg_completion    = rng.uniform(8, 120, n)
    is_unassigned     = rng.binomial(1, 0.2, n)

    # Composite delay score
    delay_score = (
        np.clip(-hours_to_deadline / 200, 0, 1) * 0.35 +
        priority_encoded / 3 * 0.15 +
        np.clip(workload / 150, 0, 1) * 0.20 +
        overdue_rate * 0.20 +
        dependency_depth / 5 * 0.10
    )
    delayed = (delay_score + rng.normal(0, 0.05, n) > 0.45).astype(int)

    return pd.DataFrame({
        "hours_to_deadline":             hours_to_deadline,
        "priority_encoded":              priority_encoded,
        "status_encoded":                status_encoded,
        "estimated_hours":               estimated_hours,
        "dependency_depth":              dependency_depth,
        "assignee_workload_hours":       workload,
        "assignee_overdue_rate":         overdue_rate,
        "assignee_avg_completion_hours": avg_completion,
        "is_unassigned":                 is_unassigned,
        "delayed":                       delayed,
    })


def train(df: pd.DataFrame = None) -> CalibratedClassifierCV:
    if df is None:
        df = generate_synthetic_data()

    X = df[FEATURE_NAMES].values
    y = df["delayed"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = build_model()
    model.fit(X_train, y_train)

    y_prob = model.predict_proba(X_test)[:, 1]
    y_pred = (y_prob > 0.5).astype(int)
    print(f"AUC-ROC: {roc_auc_score(y_test, y_prob):.3f}")
    print(classification_report(y_test, y_pred, target_names=["on_time", "delayed"]))

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    logger.info(f"✓ Saved delay predictor → {MODEL_PATH}")
    return model


def load() -> CalibratedClassifierCV:
    return joblib.load(MODEL_PATH)


def predict_batch(
    tasks: list[dict],
    model: CalibratedClassifierCV,
    workload: dict,
    history: dict,
) -> list[dict]:
    """
    tasks:    list of task dicts (from Supabase)
    model:    loaded CalibratedClassifierCV
    workload: {assignee_id: float} total estimated hours per person
    history:  {assignee_id: {overdue_rate, avg_completion_time}}
    """
    if not tasks:
        return []

    X = np.stack([task_feature_vector(t, workload, history) for t in tasks])
    probs = model.predict_proba(X)[:, 1]

    results = []
    for task, prob in zip(tasks, probs):
        if prob >= 0.7:
            risk = "high"
        elif prob >= 0.4:
            risk = "medium"
        else:
            risk = "low"

        results.append({
            "task_id":           task["id"],
            "delay_probability": round(float(prob), 3),
            "risk_level":        risk,
            "reasoning":         _reasoning(task, prob, workload, history),
        })

    return results


def _reasoning(task: dict, prob: float, workload: dict, history: dict) -> str:
    reasons = []
    assignee = task.get("assignee_id") or "unassigned"

    if task.get("deadline"):
        try:
            hours_left = (
                pd.Timestamp(task["deadline"]).tz_localize(None) -
                pd.Timestamp.utcnow().tz_localize(None)
            ).total_seconds() / 3600
            if hours_left < 0:
                reasons.append("deadline already passed")
            elif hours_left < 24:
                reasons.append("less than 24 hours until deadline")
            elif hours_left < 72:
                reasons.append("less than 3 days until deadline")
        except Exception:
            pass

    wl = workload.get(assignee, 0)
    if wl > 100:
        reasons.append(f"assignee has {wl:.0f}h of queued work (overloaded)")
    elif wl > 60:
        reasons.append(f"assignee has {wl:.0f}h of queued work (high load)")

    if history.get(assignee, {}).get("overdue_rate", 0) > 0.3:
        reasons.append("high historical overdue rate for this assignee")

    depth = task.get("dependency_depth", 0) or 0
    if depth > 2:
        reasons.append(f"deep dependency chain (depth {depth})")

    if task.get("assignee_id") is None:
        reasons.append("task is unassigned")

    return "; ".join(reasons) if reasons else f"model confidence {prob:.0%}"
