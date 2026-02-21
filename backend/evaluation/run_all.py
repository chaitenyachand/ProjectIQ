"""
run_all.py  (evaluation)
─────────────────────────
Run all evaluation scripts and generate the final dashboard.

Usage:
  python3 evaluation/run_all.py
  python3 evaluation/run_all.py --quick
"""

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def run_script(script: str, extra: list[str] = []) -> bool:
    cmd = [sys.executable, str(ROOT / "evaluation" / script)] + extra
    print(f"\n{'='*60}")
    print(f"  Running: {' '.join(cmd)}")
    print(f"{'='*60}")
    result = subprocess.run(cmd)
    return result.returncode == 0


def main():
    ap = argparse.ArgumentParser(description="Run full evaluation pipeline")
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()

    extra = ["--quick"] if args.quick else []
    results = []

    ok = run_script("evaluate_relevance.py", extra)
    results.append(("Relevance", ok))

    ok = run_script("evaluate_intent.py", extra)
    results.append(("Intent", ok))

    ok = run_script("confusion_matrices.py")
    results.append(("Dashboard", ok))

    print(f"\n{'='*60}")
    print("  EVALUATION COMPLETE")
    print(f"{'='*60}")
    for name, ok in results:
        status = "✓" if ok else "✗"
        print(f"  {status} {name}")

    out_dir = ROOT / "evaluation" / "results"
    print(f"\n  Results saved to: {out_dir}/")
    print("    relevance_report.json")
    print("    relevance_pr_curve.png")
    print("    relevance_threshold_analysis.png")
    print("    intent_report.json")
    print("    intent_confusion_matrix.png")
    print("    intent_class_breakdown.png")
    print("    summary_dashboard.png")


if __name__ == "__main__":
    main()