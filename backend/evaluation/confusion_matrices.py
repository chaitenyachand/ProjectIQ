"""
confusion_matrices.py
─────────────────────
Generate a combined confusion matrix report for all trained models.
Loads existing evaluation results and produces a single multi-panel figure.

Output:
  evaluation/results/all_confusion_matrices.png
  evaluation/results/summary_dashboard.png

Usage:
  python3 evaluation/confusion_matrices.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

ROOT    = Path(__file__).parent.parent
EVAL    = ROOT / "evaluation" / "results"
OUT_DIR = EVAL


def load_report(name: str) -> dict | None:
    path = EVAL / f"{name}_report.json"
    if not path.exists():
        print(f"  ⚠ {name} report not found: {path}")
        return None
    with open(path) as f:
        return json.load(f)


def make_metric_bar(ax, metrics: dict, title: str):
    """Horizontal bar chart of key metrics."""
    keys   = ["accuracy", "f1", "f1_macro", "f1_weighted", "roc_auc",
              "average_precision", "precision", "recall"]
    labels, vals = [], []
    for k in keys:
        if k in metrics and isinstance(metrics[k], float):
            labels.append(k.replace("_", "\n"))
            vals.append(metrics[k])

    if not vals:
        ax.text(0.5, 0.5, "No metrics available", ha="center", va="center",
                transform=ax.transAxes)
        ax.set_title(title)
        return

    colors = ["#2ecc71" if v >= 0.8 else "#f39c12" if v >= 0.6 else "#e74c3c"
              for v in vals]
    bars = ax.barh(labels, vals, color=colors, alpha=0.85)

    for bar, val in zip(bars, vals):
        ax.text(val + 0.01, bar.get_y() + bar.get_height() / 2,
                f"{val:.3f}", va="center", fontsize=9)

    ax.set_xlim(0, 1.15)
    ax.axvline(x=0.8, color="green",  linestyle="--", alpha=0.4, linewidth=1)
    ax.axvline(x=0.6, color="orange", linestyle="--", alpha=0.4, linewidth=1)
    ax.set_title(title, fontweight="bold", pad=8)
    ax.set_xlabel("Score")
    ax.grid(True, axis="x", alpha=0.3)


def make_summary_dashboard():
    """One-page summary of all model metrics."""
    reports = {
        "Relevance": load_report("relevance"),
        "Intent":    load_report("intent"),
    }

    fig, axes = plt.subplots(1, len(reports), figsize=(6 * len(reports), 6))
    if len(reports) == 1:
        axes = [axes]

    fig.suptitle("BRD Agent ML — Model Performance Dashboard",
                 fontsize=14, fontweight="bold", y=1.02)

    for ax, (name, report) in zip(axes, reports.items()):
        if report is None:
            ax.text(0.5, 0.5, f"{name}\n(not yet evaluated)",
                    ha="center", va="center", transform=ax.transAxes,
                    fontsize=12, color="gray")
            ax.set_title(name)
            continue
        make_metric_bar(ax, report, f"{name} Classifier")

    fig.tight_layout()
    out_path = OUT_DIR / "summary_dashboard.png"
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  Saved summary dashboard → {out_path}")


def make_intent_class_breakdown():
    """Bar chart of per-class F1 for intent model."""
    report = load_report("intent")
    if not report or "per_class" not in report:
        return

    per_class = report["per_class"]
    classes = [c["class"] for c in per_class]
    f1s     = [c["f1"] for c in per_class]
    support = [c["support"] for c in per_class]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

    # F1 per class
    colors = ["#2ecc71" if f >= 0.7 else "#f39c12" if f >= 0.5 else "#e74c3c" for f in f1s]
    ax1.bar(classes, f1s, color=colors, alpha=0.85)
    ax1.set_ylabel("F1 Score")
    ax1.set_title("Intent F1 Per Class", fontweight="bold")
    ax1.set_ylim(0, 1.05)
    ax1.axhline(y=0.7, color="green",  linestyle="--", alpha=0.5, label="Good (0.7)")
    ax1.axhline(y=0.5, color="orange", linestyle="--", alpha=0.5, label="Acceptable (0.5)")
    ax1.legend(fontsize=8)
    for i, (f, c) in enumerate(zip(f1s, classes)):
        ax1.text(i, f + 0.01, f"{f:.2f}", ha="center", va="bottom", fontsize=9)
    ax1.tick_params(axis="x", rotation=30)

    # Support per class
    ax2.bar(classes, support, color="#3498db", alpha=0.75)
    ax2.set_ylabel("# Training Samples")
    ax2.set_title("Intent Class Support", fontweight="bold")
    for i, (s, c) in enumerate(zip(support, classes)):
        ax2.text(i, s + max(support) * 0.01, str(s), ha="center", va="bottom", fontsize=9)
    ax2.tick_params(axis="x", rotation=30)

    fig.suptitle("Intent Classifier — Detailed Breakdown", fontsize=13, fontweight="bold")
    fig.tight_layout()
    out_path = OUT_DIR / "intent_class_breakdown.png"
    fig.savefig(out_path, dpi=150)
    plt.close()
    print(f"  Saved intent class breakdown → {out_path}")


def print_text_summary():
    """Print a human-readable metric summary to console."""
    print("\n" + "=" * 60)
    print("  EVALUATION SUMMARY")
    print("=" * 60)

    for name in ["relevance", "intent"]:
        report = load_report(name)
        if not report:
            print(f"\n  {name.upper()}: not yet evaluated")
            continue

        print(f"\n  {name.upper()} MODEL:")
        for metric in ["accuracy", "f1", "f1_macro", "f1_weighted", "roc_auc", "average_precision"]:
            if metric in report:
                val = report[metric]
                bar = "█" * int(val * 20) + "░" * (20 - int(val * 20))
                grade = "✓ Good" if val >= 0.8 else "~ OK" if val >= 0.6 else "✗ Needs work"
                print(f"    {metric:<20} {bar} {val:.3f}  {grade}")

        if "per_class" in report:
            print(f"\n    Intent F1 by class:")
            for c in report["per_class"]:
                bar = "█" * int(c["f1"] * 10) + "░" * (10 - int(c["f1"] * 10))
                print(f"      {c['class']:<14} {bar} {c['f1']:.3f}  (n={c['support']})")


def main():
    print("=" * 60)
    print("  Generating Confusion Matrices & Dashboard")
    print("=" * 60)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    make_summary_dashboard()
    make_intent_class_breakdown()
    print_text_summary()

    print(f"\n✓ All evaluation artifacts saved to {OUT_DIR}/")


if __name__ == "__main__":
    main()