"""
train_relevance.py
──────────────────
Train a binary relevance classifier.
  1 = BRD-relevant  |  0 = noise

Fix: SentenceEmbedder imported from preprocessing.embedder (stable path for joblib).

Usage:
  python3 training/train_relevance.py
  python3 training/train_relevance.py --quick
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from sklearn.linear_model import LogisticRegression
from sklearn.calibration import CalibratedClassifierCV
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.utils.class_weight import compute_class_weight

ROOT      = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from preprocessing.embedder import SentenceEmbedder, EMBED_MODEL

DATA_PATH = ROOT / "data" / "processed" / "all_sentences.csv"
OUT_DIR   = ROOT / "artifacts"
OUT_PATH  = OUT_DIR / "relevance_model_v1.joblib"
RANDOM_SEED = 42


def load_data(csv_path: Path, quick: bool = False):
    print(f"  Loading data from {csv_path}")
    df = pd.read_csv(csv_path, dtype=str)
    df["is_relevant"] = pd.to_numeric(df["is_relevant"], errors="coerce")
    df = df[df["is_relevant"].isin([0, 1])].copy()

    if df.empty:
        print("✗ No labeled data found. Run preprocessing first.")
        sys.exit(1)

    pos = df["is_relevant"].eq(1).sum()
    neg = df["is_relevant"].eq(0).sum()
    print(f"  Total labeled: {len(df):,}")
    print(f"  Relevant (1): {pos:,} ({pos/len(df)*100:.1f}%)")
    print(f"  Noise    (0): {neg:,} ({neg/len(df)*100:.1f}%)")

    if quick:
        # Balanced sample for quick mode
        n_each = min(1000, pos, neg)
        pos_df = df[df["is_relevant"] == 1].sample(n=n_each, random_state=RANDOM_SEED)
        neg_df = df[df["is_relevant"] == 0].sample(n=n_each, random_state=RANDOM_SEED)
        df = pd.concat([pos_df, neg_df]).sample(frac=1, random_state=RANDOM_SEED)
        print(f"  Quick mode: {len(df):,} balanced rows")

    return df["sentence"].fillna("").tolist(), df["is_relevant"].astype(int).values


def train(sentences, labels):
    classes = np.unique(labels)
    weights = compute_class_weight("balanced", classes=classes, y=labels)
    cw = dict(zip(classes.tolist(), weights.tolist()))
    print(f"\n  Class weights: {cw}")

    print("\n  Embedding sentences...")
    embedder = SentenceEmbedder(EMBED_MODEL)
    X = embedder.transform(sentences)
    print(f"  Shape: {X.shape}")

    base_clf = LogisticRegression(
        C=1.0, max_iter=1000, class_weight=cw,
        random_state=RANDOM_SEED, solver="lbfgs", n_jobs=-1,
    )
    clf = CalibratedClassifierCV(base_clf, cv=3, method="sigmoid")

    print("\n  5-fold cross-validation...")
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_SEED)
    cv_results = cross_validate(
        clf, X, labels, cv=cv,
        scoring=["accuracy", "f1", "roc_auc", "precision", "recall"],
        n_jobs=-1,
    )

    metrics = {k.replace("test_", ""): float(v.mean())
               for k, v in cv_results.items() if k.startswith("test_")}
    metrics["cv_folds"] = 5

    print(f"\n  CV Results:")
    for k, v in metrics.items():
        if isinstance(v, float):
            print(f"    {k:<12} {v:.4f}")

    print("\n  Training final model...")
    clf.fit(X, labels)

    return {
        "embedder":      embedder,
        "classifier":    clf,
        "metrics":       metrics,
        "label_meaning": {0: "noise", 1: "relevant"},
        "embed_model":   EMBED_MODEL,
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
    print("  Training Relevance Classifier")
    print("=" * 60)

    sentences, labels = load_data(Path(args.input), quick=args.quick)
    result = train(sentences, labels)

    joblib.dump(result, args.output, compress=3)
    print(f"\n✓ Model saved → {args.output}")

    metrics_path = Path(args.output).with_suffix(".metrics.json")
    with open(metrics_path, "w") as f:
        json.dump({k: v for k, v in result.items()
                   if k not in ("embedder", "classifier")}, f, indent=2)
    print(f"✓ Metrics saved → {metrics_path}")


if __name__ == "__main__":
    main()