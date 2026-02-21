"""
train_timeline.py
─────────────────
Train a binary classifier to detect timeline/deadline mentions.

  Label 1 = sentence contains a date, deadline, or temporal reference
  Label 0 = no timeline signal

This is a high-precision task — false positives (saying something has a
timeline when it doesn't) are worse than false negatives for BRD quality.

Architecture:
  sentence-transformers/all-MiniLM-L6-v2 embeddings
  + hand-crafted timeline features (regex counts, token flags)
  → LogisticRegression with high precision threshold

Output:
  artifacts/timeline_model_v1.joblib

Usage:
  python3 training/train_timeline.py
  python3 training/train_timeline.py --quick
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.utils.class_weight import compute_class_weight
from sklearn.metrics import precision_recall_curve
from sentence_transformers import SentenceTransformer

ROOT      = Path(__file__).parent.parent
DATA_PATH = ROOT / "data" / "processed" / "all_sentences.csv"
OUT_DIR   = ROOT / "artifacts"
OUT_PATH  = OUT_DIR / "timeline_model_v1.joblib"

EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BATCH_SIZE  = 256
RANDOM_SEED = 42

# ─── Feature engineering ──────────────────────────────────────────────────────

_PATTERNS = {
    "has_date_numeric":   re.compile(r"\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}"),
    "has_month_name":     re.compile(r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\b", re.I),
    "has_day_name":       re.compile(r"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", re.I),
    "has_quarter":        re.compile(r"\bQ[1-4]\b|\bquarter\s+[1-4]\b", re.I),
    "has_eox":            re.compile(r"\b(eow|eom|eoq|eoy)\b", re.I),
    "has_deadline_word":  re.compile(r"\b(deadline|due\s+date|due\s+by|by\s+\w+|no\s+later\s+than)\b", re.I),
    "has_schedule_word":  re.compile(r"\b(schedule[d]?|plan[s]?|target[s]?|expect[s]?|aim[s]?)\b", re.I),
    "has_next_period":    re.compile(r"\b(next\s+(week|month|quarter|year|sprint|release))\b", re.I),
    "has_by_phrase":      re.compile(r"\bby\s+(end\s+of|the\s+end|next|this|monday|tuesday|wednesday|thursday|friday)\b", re.I),
    "has_year":           re.compile(r"\b(20\d\d|19\d\d)\b"),
}


def extract_features(sentences: list[str]) -> np.ndarray:
    """Extract a small hand-crafted feature vector per sentence."""
    feats = []
    for sent in sentences:
        row = [1 if pat.search(sent) else 0 for pat in _PATTERNS.values()]
        # Count of total timeline signals (density feature)
        row.append(sum(row))
        feats.append(row)
    return np.array(feats, dtype=np.float32)


def load_data(csv_path: Path, quick: bool = False):
    print(f"  Loading from {csv_path}")
    df = pd.read_csv(csv_path, dtype=str)
    df["has_timeline"] = pd.to_numeric(df["has_timeline"], errors="coerce")
    df = df[df["has_timeline"].isin([0, 1])].copy()

    if df.empty:
        print("✗ No timeline-labeled data found.")
        sys.exit(1)

    pos = df["has_timeline"].eq(1).sum()
    neg = df["has_timeline"].eq(0).sum()
    print(f"  Timeline=1: {pos:,} ({pos/len(df)*100:.1f}%)")
    print(f"  Timeline=0: {neg:,} ({neg/len(df)*100:.1f}%)")

    if quick:
        n = min(3000, len(df))
        df = df.sample(n=n, random_state=RANDOM_SEED)
        print(f"  Quick mode: sampled {n:,}")

    return df["sentence"].fillna("").tolist(), df["has_timeline"].astype(int).values


def train(sentences: list[str], labels: np.ndarray) -> dict:
    # Combined features: embeddings + hand-crafted
    print("\n  Embedding sentences...")
    model = SentenceTransformer(EMBED_MODEL)
    X_embed = model.encode(sentences, batch_size=BATCH_SIZE, show_progress_bar=True,
                           convert_to_numpy=True, normalize_embeddings=True)

    print("  Extracting timeline features...")
    X_feats = extract_features(sentences)

    X = np.hstack([X_embed, X_feats])
    print(f"  Combined feature shape: {X.shape}")

    classes = np.unique(labels)
    weights = compute_class_weight("balanced", classes=classes, y=labels)
    cw = dict(zip(classes.tolist(), weights.tolist()))

    clf = LogisticRegression(
        C=5.0,           # higher C = less regularization, good for precision task
        max_iter=1000,
        class_weight=cw,
        random_state=RANDOM_SEED,
        solver="lbfgs",
        n_jobs=-1,
    )

    print("\n  5-fold CV...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    cv_results = cross_validate(
        clf, X, labels, cv=cv,
        scoring=["accuracy", "f1", "roc_auc", "precision", "recall"],
        n_jobs=-1,
    )

    metrics = {
        "accuracy":  float(cv_results["test_accuracy"].mean()),
        "f1":        float(cv_results["test_f1"].mean()),
        "roc_auc":   float(cv_results["test_roc_auc"].mean()),
        "precision": float(cv_results["test_precision"].mean()),
        "recall":    float(cv_results["test_recall"].mean()),
        "cv_folds":  5,
    }

    print(f"\n  CV Metrics:")
    for k, v in metrics.items():
        if isinstance(v, float):
            print(f"    {k:<12} {v:.4f}")

    print("\n  Training final model...")
    clf.fit(X, labels)

    return {
        "embed_model":       EMBED_MODEL,
        "classifier":        clf,
        "feature_patterns":  list(_PATTERNS.keys()),
        "metrics":           metrics,
        "trained_on":        len(sentences),
        "trained_at":        datetime.utcnow().isoformat(),
        "version":           "v1",
        "label_meaning":     {0: "no_timeline", 1: "has_timeline"},
        "predict_note": (
            "At inference time, concatenate sentence embedding "
            "(all-MiniLM-L6-v2, normalized) with extract_features() output."
        ),
    }


def main():
    ap = argparse.ArgumentParser(description="Train timeline detector")
    ap.add_argument("--input",  default=str(DATA_PATH))
    ap.add_argument("--output", default=str(OUT_PATH))
    ap.add_argument("--quick",  action="store_true")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  Training Timeline Detector")
    print("=" * 60)

    sentences, labels = load_data(Path(args.input), quick=args.quick)
    result = train(sentences, labels)

    joblib.dump(result, args.output, compress=3)
    print(f"\n✓ Model saved → {args.output}")

    metrics_path = Path(args.output).with_suffix(".metrics.json")
    with open(metrics_path, "w") as f:
        json.dump({k: v for k, v in result.items()
                   if k not in ("classifier",)}, f, indent=2)
    print(f"✓ Metrics saved → {metrics_path}")


if __name__ == "__main__":
    main()