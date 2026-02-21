"""
training/run_all.py  ← THE ONE SCRIPT TO RULE THEM ALL
═══════════════════════════════════════════════════════
Unified training entry point for the SmartOps backend.
Run this from backend/ — it handles everything.

What it trains:
  Phase 1 — TF-IDF models (fast, ~2-3 min, API works immediately after)
    data/processed/models/relevance_tfidf.joblib
    data/processed/models/intent_tfidf.joblib + intent_encoder.joblib
    data/processed/models/delay_predictor.joblib

  Phase 2 — Sentence-transformer models (better quality, 10-30 min on CPU)
    artifacts/relevance_model_v1.joblib
    artifacts/intent_model_v1.joblib
    artifacts/timeline_model_v1.joblib

The API (model_registry.py) auto-upgrades to ST models when available.

Prerequisites:
  python3 preprocessing/run_all.py   → data/processed/all_sentences.csv

Usage:
  python3 training/run_all.py                    # full pipeline (TF-IDF + ST)
  python3 training/run_all.py --tfidf-only       # fast path, get API running NOW
  python3 training/run_all.py --st-only          # only ST (assumes TF-IDF done)
  python3 training/run_all.py --quick            # small data, smoke test
  python3 training/run_all.py --skip-delay       # skip delay predictor
"""

import argparse
import logging
import subprocess
import sys
from pathlib import Path

# Run from backend/ root
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

CSV = ROOT / "data" / "processed" / "all_sentences.csv"


# ─── Phase 1: TF-IDF (fast) ──────────────────────────────────────────────────

def train_tfidf_relevance():
    print("\n" + "─" * 60)
    print("  [TF-IDF] Relevance Classifier")
    print("─" * 60)
    from ml.relevance_classifier import train_tfidf
    train_tfidf(str(CSV))


def train_tfidf_intent():
    print("\n" + "─" * 60)
    print("  [TF-IDF] Intent Classifier (with oversampling)")
    print("─" * 60)
    from ml.intent_classifier import train_tfidf
    train_tfidf(str(CSV))


def train_delay():
    print("\n" + "─" * 60)
    print("  Delay Predictor (GradientBoosting + Platt scaling)")
    print("─" * 60)
    from ml.delay_predictor import train
    real = ROOT / "data" / "processed" / "real_tasks.csv"
    if real.exists():
        import pandas as pd
        print(f"  Using real task data: {real}")
        train(pd.read_csv(real))
    else:
        print("  No real task data — using synthetic data")
        print("  (Improves automatically as task_events accumulate in Supabase)")
        train()


# ─── Phase 2: Sentence-transformer (better) ──────────────────────────────────

def train_st(quick: bool = False):
    print("\n" + "─" * 60)
    print("  [Sentence-Transformer] Models")
    print("  (API auto-upgrades to these — no restart needed after reload)")
    print("─" * 60)

    scripts_dir = ROOT / "training"
    extra = ["--quick"] if quick else []

    for script in ["train_relevance.py", "train_intent.py", "train_timeline.py"]:
        path = scripts_dir / script
        if not path.exists():
            logger.warning(f"  ⚠ {script} not found — skipping")
            continue
        print(f"\n  ▶ {script}")
        result = subprocess.run([sys.executable, str(path)] + extra, cwd=str(ROOT))
        print(f"  {'✓' if result.returncode == 0 else '✗'} {script}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Train all SmartOps ML models",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 training/run_all.py --tfidf-only   # fast (~2 min), API runs immediately
  python3 training/run_all.py --quick        # smoke test on small data
  python3 training/run_all.py                # full pipeline
        """
    )
    ap.add_argument("--tfidf-only",     action="store_true", help="Only TF-IDF (~2 min, gets API running)")
    ap.add_argument("--st-only",        action="store_true", help="Only sentence-transformer models")
    ap.add_argument("--skip-delay",     action="store_true", help="Skip delay predictor")
    ap.add_argument("--skip-relevance", action="store_true")
    ap.add_argument("--skip-intent",    action="store_true")
    ap.add_argument("--quick",          action="store_true", help="Small data subset (smoke test)")
    args = ap.parse_args()

    # Guard
    if not CSV.exists() and not (args.skip_relevance and args.skip_intent):
        print(f"✗ Training data not found: {CSV}")
        print()
        print("  Fix: run preprocessing first:")
        print("    python3 preprocessing/run_all.py")
        print()
        print("  If your data is in ml/data/, symlink it:")
        print("    ln -s ../ml/data/processed data/processed")
        sys.exit(1)

    print("=" * 60)
    print("  SmartOps ML Training")
    print(f"  Data: {CSV} ({CSV.stat().st_size/1e6:.0f} MB)" if CSV.exists() else "")
    print("=" * 60)

    # ── Phase 1: TF-IDF ──────────────────────────────────────────────────────
    if not args.st_only:
        print("\n━━━ PHASE 1: TF-IDF Models (fast — API can start after this) ━━━")

        if not args.skip_relevance:
            train_tfidf_relevance()
        if not args.skip_intent:
            train_tfidf_intent()
        if not args.skip_delay:
            train_delay()

        print("\n" + "━" * 60)
        print("  ✓ Phase 1 complete — start the API now:")
        print("    uvicorn main:app --reload --port 8000")
        print("━" * 60)

    # ── Phase 2: Sentence-transformer ────────────────────────────────────────
    if not args.tfidf_only:
        print("\n━━━ PHASE 2: Sentence-Transformer Models (better quality) ━━━")
        if not args.skip_relevance or not args.skip_intent:
            train_st(quick=args.quick)

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  ✓ Training complete!")
    print()

    tfidf_dir = ROOT / "data" / "processed" / "models"
    st_dir    = ROOT / "artifacts"

    tfidf_models = sorted(tfidf_dir.glob("*.joblib")) if tfidf_dir.exists() else []
    st_models    = sorted(st_dir.glob("*.joblib"))    if st_dir.exists()    else []

    if tfidf_models:
        print("  TF-IDF models:")
        for p in tfidf_models:
            print(f"    {p.relative_to(ROOT)}  ({p.stat().st_size/1e6:.1f} MB)")

    if st_models:
        print("  Sentence-transformer models:")
        for p in st_models:
            print(f"    {p.relative_to(ROOT)}  ({p.stat().st_size/1e6:.1f} MB)")

    print()
    print("  Next:")
    print("    uvicorn main:app --reload --port 8000")
    print("    curl http://localhost:8000/health")
    print("=" * 60)


if __name__ == "__main__":
    main()