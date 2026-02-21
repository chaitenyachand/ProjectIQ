"""
preprocessing/run_all.py
Run from backend/ root — parses all datasets into data/processed/all_sentences.csv

Usage:
  python3 preprocessing/run_all.py
  python3 preprocessing/run_all.py --limit-enron 10000  # quick test
  python3 preprocessing/run_all.py --skip-enron          # if not downloaded yet
"""

import argparse, subprocess, sys
from pathlib import Path

import pandas as pd

ROOT      = Path(__file__).parent.parent
PROCESSED = ROOT / "data" / "processed"
ALL_OUT   = PROCESSED / "all_sentences.csv"


def run(script: str, extra: list = []) -> bool:
    cmd = [sys.executable, str(ROOT / "preprocessing" / script)] + extra
    print(f"\n{'='*60}\n  {' '.join(cmd)}\n{'='*60}")
    return subprocess.run(cmd, cwd=str(ROOT)).returncode == 0


def merge():
    sources = {
        "enron":    PROCESSED / "enron_sentences.csv",
        "ami":      PROCESSED / "ami_sentences.csv",
        "meetings": PROCESSED / "meetings_sentences.csv",
    }
    dfs = []
    for name, path in sources.items():
        if not path.exists() or path.stat().st_size < 100:
            print(f"  ⚠ {name}: skipping ({path})")
            continue
        try:
            df = pd.read_csv(path, dtype=str)
            if df.empty: continue
            df["source"] = name
            dfs.append(df)
            print(f"  ✓ {name}: {len(df):,} sentences")
        except Exception as e:
            print(f"  ⚠ {name}: {e}")

    if not dfs:
        print("✗ No data to merge."); return

    merged = pd.concat(dfs, ignore_index=True).drop_duplicates(subset=["sentence_id"])
    merged.to_csv(ALL_OUT, index=False)

    print(f"\n  Merged: {len(merged):,} unique sentences → {ALL_OUT}")
    merged["is_relevant"] = pd.to_numeric(merged["is_relevant"], errors="coerce")
    print(f"  Relevant: {merged['is_relevant'].eq(1).sum():,} | "
          f"Noise: {merged['is_relevant'].eq(0).sum():,}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit-enron",   type=int)
    ap.add_argument("--skip-enron",    action="store_true")
    ap.add_argument("--skip-ami",      action="store_true")
    ap.add_argument("--skip-meetings", action="store_true")
    args = ap.parse_args()

    PROCESSED.mkdir(parents=True, exist_ok=True)

    if not args.skip_enron:
        extra = ["--limit", str(args.limit_enron)] if args.limit_enron else []
        run("parse_enron.py", extra)
    if not args.skip_ami:
        run("parse_ami.py")
    if not args.skip_meetings:
        run("parse_meetings.py")

    print(f"\n{'='*60}\n  Merging\n{'='*60}")
    merge()
    print("\n✓ Preprocessing done! Next: python3 training/run_all.py --tfidf-only")


if __name__ == "__main__":
    main()