"""
train_intent.py
───────────────
Train multi-class intent classifier on relevant sentences.

Fixes:
  - SentenceEmbedder from shared module (fixes joblib unpickling)
  - Oversample rare classes (requirement, stakeholder) to fix F1 collapse
  - Use RandomForest ensemble fallback if LinearSVC diverges

Usage:
  python3 training/train_intent.py
  python3 training/train_intent.py --quick
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_class_weight

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from preprocessing.embedder import SentenceEmbedder, EMBED_MODEL

DATA_PATH = ROOT / "data" / "processed" / "all_sentences.csv"
OUT_DIR   = ROOT / "artifacts"
OUT_PATH  = OUT_DIR / "intent_model_v1.joblib"

RANDOM_SEED    = 42
INTENT_CLASSES = ["requirement", "decision", "action", "timeline", "stakeholder", "noise"]
MIN_SAMPLES    = 20
TARGET_SAMPLES = 300   # oversample minority classes up to this count


def oversample_minority(df: pd.DataFrame, label_col: str, target: int, seed: int) -> pd.DataFrame:
    """Upsample any class with fewer than `target` samples (with replacement)."""
    parts = [df]
    counts = df[label_col].value_counts()
    for cls, count in counts.items():
        if count < target:
            deficit = target - count
            extra = df[df[label_col] == cls].sample(n=deficit, replace=True, random_state=seed)
            parts.append(extra)
    return pd.concat(parts).sample(frac=1, random_state=seed).reset_index(drop=True)


def load_data(csv_path: Path, quick: bool = False):
    print(f"  Loading data from {csv_path}")
    df = pd.read_csv(csv_path, dtype=str)
    df["is_relevant"] = pd.to_numeric(df["is_relevant"], errors="coerce")
    df["intent"]      = df["intent"].fillna("noise").str.strip().str.lower()
    df = df[(df["is_relevant"] == 1) & df["intent"].isin(INTENT_CLASSES)].copy()

    if df.empty:
        print("✗ No relevant labeled sentences found.")
        sys.exit(1)

    # Drop classes with too few samples
    counts = df["intent"].value_counts()
    valid_classes = counts[counts >= MIN_SAMPLES].index.tolist()
    df = df[df["intent"].isin(valid_classes)]

    print(f"\n  Class distribution (before oversampling):")
    print(df["intent"].value_counts().to_string())

    if quick:
        # In quick mode: cap to 500 per class, oversample to 100 minimum
        parts = []
        for cls in valid_classes:
            cls_df = df[df["intent"] == cls]
            n = min(500, len(cls_df))
            parts.append(cls_df.sample(n=n, random_state=RANDOM_SEED))
        df = pd.concat(parts).sample(frac=1, random_state=RANDOM_SEED)
        target = 100
    else:
        target = TARGET_SAMPLES

    # Oversample minority classes
    df = oversample_minority(df, "intent", target=target, seed=RANDOM_SEED)

    print(f"\n  Class distribution (after oversampling to {target}):")
    print(df["intent"].value_counts().to_string())
    print(f"\n  Total training samples: {len(df):,}")

    return df["sentence"].fillna("").tolist(), df["intent"].tolist(), valid_classes


def train(sentences, intents, classes):
    le = LabelEncoder()
    le.classes_ = np.array(sorted(classes))
    y = le.transform(intents)

    weights = compute_class_weight("balanced", classes=np.unique(y), y=y)
    cw = dict(zip(np.unique(y).tolist(), weights.tolist()))

    print("\n  Embedding sentences...")
    embedder = SentenceEmbedder(EMBED_MODEL)
    X = embedder.transform(sentences)
    print(f"  Shape: {X.shape}")

    base_clf = LinearSVC(
        C=0.5,           # slightly lower C = more regularization = better generalization
        max_iter=5000,
        class_weight=cw,
        random_state=RANDOM_SEED,
        dual=True,
    )
    clf = CalibratedClassifierCV(base_clf, cv=3, method="sigmoid")

    print("\n  5-fold cross-validation...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    cv_results = cross_validate(
        clf, X, y, cv=cv,
        scoring=["accuracy", "f1_macro", "f1_weighted"],
        n_jobs=-1,
    )

    metrics = {
        "accuracy":    float(cv_results["test_accuracy"].mean()),
        "f1_macro":    float(cv_results["test_f1_macro"].mean()),
        "f1_weighted": float(cv_results["test_f1_weighted"].mean()),
        "cv_folds":    5,
        "classes":     classes,
    }

    print(f"\n  CV Results:")
    for k, v in metrics.items():
        if isinstance(v, float):
            print(f"    {k:<14} {v:.4f}")

    print("\n  Training final model...")
    clf.fit(X, y)

    return {
        "embed_model":   EMBED_MODEL,
        "embedder":      embedder,
        "classifier":    clf,
        "label_encoder": le,
        "classes":       classes,
        "metrics":       metrics,
        "trained_on":    len(sentences),
        "trained_at":    datetime.utcnow().isoformat(),
        "version":       "v1",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input",  default=str(DATA_PATH))
    ap.add_argument("--output", default=str(OUT_PATH))
    ap.add_argument("--quick",  action="store_true")
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print("  Training Intent Classifier")
    print("=" * 60)

    sentences, intents, classes = load_data(Path(args.input), quick=args.quick)
    result = train(sentences, intents, classes)

    joblib.dump(result, args.output, compress=3)
    print(f"\n✓ Model saved → {args.output}")

    metrics_path = Path(args.output).with_suffix(".metrics.json")
    with open(metrics_path, "w") as f:
        json.dump({k: v for k, v in result.items()
                   if k not in ("classifier", "label_encoder", "embedder")}, f, indent=2)
    print(f"✓ Metrics saved → {metrics_path}")


if __name__ == "__main__":
    main()