"""
evaluate_relevance.py
─────────────────────
Evaluate the trained relevance classifier.

Fix: imports SentenceEmbedder from preprocessing.embedder so joblib
     can unpickle the saved model correctly.

Output:
  evaluation/results/relevance_report.json
  evaluation/results/relevance_pr_curve.png
  evaluation/results/relevance_threshold_analysis.png

Usage:
  python3 evaluation/evaluate_relevance.py
  python3 evaluation/evaluate_relevance.py --quick
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
    classification_report, roc_auc_score,
    precision_recall_curve, average_precision_score,
    confusion_matrix,
)

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

# ── CRITICAL: import SentenceEmbedder so joblib can unpickle it ───────────────
from preprocessing.embedder import SentenceEmbedder  # noqa: F401
from sentence_transformers import SentenceTransformer

MODEL    = ROOT / "artifacts" / "relevance_model_v1.joblib"
DATA     = ROOT / "data" / "processed" / "all_sentences.csv"
OUT_DIR  = ROOT / "evaluation" / "results"
RANDOM_SEED = 42
BATCH_SIZE  = 256


def load_model_and_data(model_path: Path, data_path: Path, quick: bool = False):
    print(f"  Loading model: {model_path}")
    artifact = joblib.load(model_path)
    clf  = artifact["classifier"]
    embed_model_name = artifact["embed_model"]

    print(f"  Loading data: {data_path}")
    df = pd.read_csv(data_path, dtype=str)
    df["is_relevant"] = pd.to_numeric(df["is_relevant"], errors="coerce")
    df = df[df["is_relevant"].isin([0, 1])].copy()

    if quick:
        n_each = min(1000, df["is_relevant"].eq(1).sum(), df["is_relevant"].eq(0).sum())
        pos = df[df["is_relevant"] == 1].sample(n=n_each, random_state=RANDOM_SEED)
        neg = df[df["is_relevant"] == 0].sample(n=n_each, random_state=RANDOM_SEED)
        df = pd.concat([pos, neg]).sample(frac=1, random_state=RANDOM_SEED)

    sentences = df["sentence"].fillna("").tolist()
    labels    = df["is_relevant"].astype(int).values

    print(f"  Embedding {len(sentences):,} sentences for evaluation...")
    embedder = SentenceTransformer(embed_model_name)
    X = embedder.encode(sentences, batch_size=BATCH_SIZE, show_progress_bar=True,
                        convert_to_numpy=True, normalize_embeddings=True)

    return clf, X, labels, sentences, df


def plot_pr_curve(labels, probs, out_path: Path):
    precision, recall, _ = precision_recall_curve(labels, probs)
    ap = average_precision_score(labels, probs)
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.plot(recall, precision, "b-", linewidth=2, label=f"PR Curve (AP={ap:.3f})")
    ax.axhline(y=labels.mean(), color="gray", linestyle="--", label="Baseline")
    ax.set_xlabel("Recall"); ax.set_ylabel("Precision")
    ax.set_title("Relevance Classifier — Precision-Recall Curve")
    ax.legend(); ax.grid(True, alpha=0.3)
    fig.tight_layout(); fig.savefig(out_path, dpi=150); plt.close()
    print(f"  Saved PR curve → {out_path}")
    return float(ap)


def plot_threshold_analysis(labels, probs, out_path: Path):
    precision, recall, thresholds = precision_recall_curve(labels, probs)
    thresholds = np.append(thresholds, 1.0)
    f1_scores = 2 * (precision * recall) / np.clip(precision + recall, 1e-8, None)
    best_idx   = np.argmax(f1_scores)
    best_thresh = float(thresholds[best_idx])

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.plot(thresholds, precision, label="Precision", color="steelblue")
    ax.plot(thresholds, recall,    label="Recall",    color="coral")
    ax.plot(thresholds, f1_scores, label="F1",        color="green", linewidth=2)
    ax.axvline(x=0.5,        color="gray",  linestyle="--", label="Default (0.5)")
    ax.axvline(x=best_thresh, color="green", linestyle=":", alpha=0.7,
               label=f"Best F1 ({best_thresh:.2f})")
    ax.set_xlabel("Threshold"); ax.set_ylabel("Score")
    ax.set_title("Relevance Classifier — Threshold Analysis")
    ax.legend(); ax.grid(True, alpha=0.3); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    fig.tight_layout(); fig.savefig(out_path, dpi=150); plt.close()
    print(f"  Best threshold: {best_thresh:.3f} (F1={f1_scores[best_idx]:.3f})")
    print(f"  Saved threshold analysis → {out_path}")
    return best_thresh, float(f1_scores[best_idx])


def error_analysis(labels, probs, sentences, df, n=10):
    preds = (probs >= 0.5).astype(int)
    fp_idx = np.where((preds == 1) & (labels == 0))[0]
    fn_idx = np.where((preds == 0) & (labels == 1))[0]
    top_fp = fp_idx[np.argsort(-probs[fp_idx])[:n]]
    top_fn = fn_idx[np.argsort(probs[fn_idx])[:n]]
    src = df["source"].values if "source" in df.columns else [""] * len(labels)
    return {
        "false_positives": [{"sentence": sentences[i], "confidence": float(probs[i]), "source": src[i]} for i in top_fp],
        "false_negatives": [{"sentence": sentences[i], "confidence": float(probs[i]), "source": src[i]} for i in top_fn],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model",  default=str(MODEL))
    ap.add_argument("--input",  default=str(DATA))
    ap.add_argument("--quick",  action="store_true")
    args = ap.parse_args()

    if not Path(args.model).exists():
        print(f"✗ Model not found: {args.model}")
        print("  Run: python3 training/train_relevance.py")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print("=" * 60)
    print("  Evaluating Relevance Classifier")
    print("=" * 60)

    clf, X, labels, sentences, df = load_model_and_data(
        Path(args.model), Path(args.input), quick=args.quick
    )

    probs = clf.predict_proba(X)[:, 1]
    preds = (probs >= 0.5).astype(int)

    report = classification_report(labels, preds, target_names=["noise", "relevant"], output_dict=True)
    auc    = roc_auc_score(labels, probs)
    cm     = confusion_matrix(labels, preds)

    print(f"\n  Classification Report:")
    print(classification_report(labels, preds, target_names=["noise", "relevant"]))
    print(f"  ROC-AUC: {auc:.4f}")
    print(f"\n  Confusion Matrix:")
    print(f"           Pred:noise  Pred:relevant")
    print(f"  True:noise     {cm[0,0]:>6}         {cm[0,1]:>6}")
    print(f"  True:relevant  {cm[1,0]:>6}         {cm[1,1]:>6}")

    ap_score             = plot_pr_curve(labels, probs, OUT_DIR / "relevance_pr_curve.png")
    best_thresh, best_f1 = plot_threshold_analysis(labels, probs, OUT_DIR / "relevance_threshold_analysis.png")
    errors               = error_analysis(labels, probs, sentences, df)

    full_report = {
        "classification_report": report,
        "roc_auc":               float(auc),
        "average_precision":     float(ap_score),
        "optimal_threshold":     float(best_thresh),
        "optimal_f1":            float(best_f1),
        "confusion_matrix":      cm.tolist(),
        "n_samples":             int(len(labels)),
        "n_positive":            int(labels.sum()),
        "error_analysis":        errors,
    }

    report_path = OUT_DIR / "relevance_report.json"
    with open(report_path, "w") as f:
        json.dump(full_report, f, indent=2)
    print(f"\n✓ Report saved → {report_path}")


if __name__ == "__main__":
    main()