"""
evaluate_intent.py
──────────────────
Evaluate the trained intent classifier.

Output:
  evaluation/results/intent_report.json
  evaluation/results/intent_confusion_matrix.png

Usage:
  python3 evaluation/evaluate_intent.py
  python3 evaluation/evaluate_intent.py --quick
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.metrics import (
    classification_report, confusion_matrix,
    f1_score, accuracy_score,
)
from sentence_transformers import SentenceTransformer

ROOT    = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
from preprocessing.embedder import SentenceEmbedder  # noqa: F401 — required for joblib unpickling

MODEL   = ROOT / "artifacts" / "intent_model_v1.joblib"
DATA    = ROOT / "data" / "processed" / "all_sentences.csv"
OUT_DIR = ROOT / "evaluation" / "results"

RANDOM_SEED = 42
BATCH_SIZE  = 256

INTENT_CLASSES = ["requirement", "decision", "action", "timeline", "stakeholder", "noise"]


def load_and_evaluate(model_path: Path, data_path: Path, quick: bool = False):
    print(f"  Loading model: {model_path}")
    artifact = joblib.load(model_path)
    clf      = artifact["classifier"]
    le       = artifact["label_encoder"]
    classes  = artifact["classes"]
    embed_model_name = artifact["embed_model"]

    print(f"  Loading data: {data_path}")
    df = pd.read_csv(data_path, dtype=str)
    df["is_relevant"] = pd.to_numeric(df["is_relevant"], errors="coerce")
    df["intent"]      = df["intent"].fillna("noise").str.strip().str.lower()
    df = df[(df["is_relevant"] == 1) & df["intent"].isin(classes)].copy()

    if df.empty:
        print("✗ No relevant labeled data found.")
        sys.exit(1)

    if quick:
        df = df.sample(n=min(2000, len(df)), random_state=RANDOM_SEED)

    sentences = df["sentence"].fillna("").tolist()
    labels    = le.transform(df["intent"].tolist())

    print(f"  Embedding {len(sentences):,} sentences...")
    embedder = SentenceTransformer(embed_model_name)
    X = embedder.encode(sentences, batch_size=BATCH_SIZE, show_progress_bar=True,
                        convert_to_numpy=True, normalize_embeddings=True)

    preds = clf.predict(X)

    return labels, preds, le, classes, sentences


def plot_confusion_matrix(labels, preds, class_names: list[str], out_path: Path):
    cm = confusion_matrix(labels, preds)
    cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True).clip(1)

    n = len(class_names)
    fig, ax = plt.subplots(figsize=(max(8, n * 1.5), max(6, n * 1.2)))

    im = ax.imshow(cm_norm, interpolation="nearest", cmap=plt.cm.Blues)
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

    tick_marks = np.arange(n)
    ax.set_xticks(tick_marks)
    ax.set_yticks(tick_marks)
    ax.set_xticklabels(class_names, rotation=45, ha="right", fontsize=11)
    ax.set_yticklabels(class_names, fontsize=11)

    thresh = cm_norm.max() / 2.0
    for i in range(n):
        for j in range(n):
            ax.text(j, i, f"{cm[i,j]}\n({cm_norm[i,j]:.2f})",
                    ha="center", va="center",
                    color="white" if cm_norm[i, j] > thresh else "black",
                    fontsize=9)

    ax.set_ylabel("True Label", fontsize=12)
    ax.set_xlabel("Predicted Label", fontsize=12)
    ax.set_title("Intent Classifier — Confusion Matrix\n(count + normalized)", fontsize=13)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close()
    print(f"  Saved confusion matrix → {out_path}")


def per_class_analysis(labels, preds, class_names: list[str]) -> list[dict]:
    """Per-class breakdown with support."""
    results = []
    for i, cls in enumerate(class_names):
        mask = labels == i
        if mask.sum() == 0:
            continue
        cls_labels = (labels == i).astype(int)
        cls_preds  = (preds  == i).astype(int)
        tp = ((cls_labels == 1) & (cls_preds == 1)).sum()
        fp = ((cls_labels == 0) & (cls_preds == 1)).sum()
        fn = ((cls_labels == 1) & (cls_preds == 0)).sum()
        prec = tp / max(tp + fp, 1)
        rec  = tp / max(tp + fn, 1)
        f1   = 2 * prec * rec / max(prec + rec, 1e-8)
        results.append({
            "class":     cls,
            "support":   int(mask.sum()),
            "precision": float(prec),
            "recall":    float(rec),
            "f1":        float(f1),
        })
    return results


def main():
    ap = argparse.ArgumentParser(description="Evaluate intent classifier")
    ap.add_argument("--model",  default=str(MODEL))
    ap.add_argument("--input",  default=str(DATA))
    ap.add_argument("--quick",  action="store_true")
    args = ap.parse_args()

    if not Path(args.model).exists():
        print(f"✗ Model not found: {args.model}")
        print("  Run: python3 training/train_intent.py")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  Evaluating Intent Classifier")
    print("=" * 60)

    labels, preds, le, classes, sentences = load_and_evaluate(
        Path(args.model), Path(args.input), quick=args.quick
    )

    print(f"\n  Classification Report:")
    print(classification_report(labels, preds, target_names=classes))

    plot_confusion_matrix(
        labels, preds, classes,
        OUT_DIR / "intent_confusion_matrix.png"
    )

    per_class = per_class_analysis(labels, preds, classes)

    report = {
        "accuracy":       float(accuracy_score(labels, preds)),
        "f1_macro":       float(f1_score(labels, preds, average="macro")),
        "f1_weighted":    float(f1_score(labels, preds, average="weighted")),
        "n_samples":      int(len(labels)),
        "classes":        classes,
        "per_class":      per_class,
    }

    report_path = OUT_DIR / "intent_report.json"
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n✓ Report saved → {report_path}")


if __name__ == "__main__":
    main()