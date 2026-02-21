"""
parse_ami.py
────────────
Parse the AMI Meeting Corpus (HuggingFace: knkarthick/AMI) into sentence records.

Input:  data/raw/ami/ami_data.json  (created by setup_datasets.sh)
Output: data/processed/ami_sentences.csv

AMI contains:
  - meeting_id: e.g. "ES2002a"
  - summary:    abstractive summary text
  - dialogue:   list of {id, speaker, text} turns

Usage:
  python3 preprocessing/parse_ami.py
  python3 preprocessing/parse_ami.py --input data/raw/ami/ami_data.json
"""

import argparse
import json
import sys
from pathlib import Path

import pandas as pd
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent.parent))
from preprocessing.sentence_splitter import split_into_sentences, SentenceRecord

ROOT = Path(__file__).parent.parent
RAW_AMI  = ROOT / "data" / "raw" / "ami" / "ami_data.json"
OUT_PATH = ROOT / "data" / "processed" / "ami_sentences.csv"


# ─── AMI-specific relevance boost ─────────────────────────────────────────────
# AMI scenario meetings are already requirement-dense; we weight them higher
SCENARIO_PREFIXES = ("ES", "IS", "TS")   # scenario meeting IDs start with these


def is_scenario_meeting(meeting_id: str) -> bool:
    return any(meeting_id.startswith(p) for p in SCENARIO_PREFIXES)


# ─── Parser ───────────────────────────────────────────────────────────────────

def parse_ami_record(record: dict) -> list[SentenceRecord]:
    """Parse one AMI record (meeting) into sentence records."""
    results = []
    meeting_id = record.get("meeting_id") or record.get("fname") or "unknown"

    # ── Dialogue turns ─────────────────────────────────────────────────────
    dialogue = record.get("dialogue") or []
    if isinstance(dialogue, str):
        # Some splits serialize as string
        try:
            dialogue = json.loads(dialogue)
        except Exception:
            dialogue = []

    for turn in dialogue:
        if not isinstance(turn, dict):
            continue
        speaker = turn.get("speaker", "")
        text    = turn.get("text", "") or turn.get("content", "")
        turn_id = turn.get("id", "")

        if not text or len(text.strip()) < 10:
            continue

        doc_id = f"{meeting_id}__{turn_id}" if turn_id else f"{meeting_id}__turn"
        metadata = {
            "speaker":    speaker,
            "meeting_id": meeting_id,
            "subject":    f"AMI Meeting {meeting_id}",
        }

        for rec in split_into_sentences(
            text=text,
            source="ami",
            doc_id=doc_id,
            metadata=metadata,
            apply_auto_labels=True,
        ):
            # Boost relevance for scenario meetings
            if is_scenario_meeting(meeting_id) and rec.is_relevant == 0:
                # Scenario meetings are almost always relevant in context;
                # keep the auto-label but note the meeting type
                pass
            results.append(rec)

    # ── Summary (ground truth signal) ──────────────────────────────────────
    summary = record.get("summary", "") or ""
    if summary and len(summary.strip()) > 30:
        doc_id = f"{meeting_id}__summary"
        metadata = {
            "speaker":    "SUMMARY",
            "meeting_id": meeting_id,
            "subject":    f"AMI Meeting {meeting_id} — Summary",
        }
        for rec in split_into_sentences(
            text=summary,
            source="ami",
            doc_id=doc_id,
            metadata=metadata,
            apply_auto_labels=True,
        ):
            # Summaries are ground-truth relevant by definition
            rec.is_relevant = 1
            if rec.intent == "noise":
                rec.intent = "requirement"
            results.append(rec)

    return results


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Parse AMI corpus → sentence CSV")
    parser.add_argument("--input",  default=str(RAW_AMI),  help="Path to ami_data.json")
    parser.add_argument("--output", default=str(OUT_PATH), help="Output CSV path")
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"✗ AMI JSON not found at {input_path}")
        print("  Run setup_datasets.sh first (it downloads AMI from HuggingFace automatically).")
        sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("Parsing AMI Meeting Corpus...")
    print(f"  Input:  {input_path}")
    print(f"  Output: {output_path}")

    with open(input_path) as f:
        records = json.load(f)

    print(f"  Found {len(records):,} meeting records")

    all_sentences: list[SentenceRecord] = []
    for record in tqdm(records, desc="AMI meetings", unit="meeting"):
        all_sentences.extend(parse_ami_record(record))

    if not all_sentences:
        print("✗ No sentences produced. Check AMI JSON format.")
        sys.exit(1)

    df = pd.DataFrame([r.to_dict() for r in all_sentences])

    before = len(df)
    df = df.drop_duplicates(subset=["sentence_id"])
    print(f"\n  Deduped: {before:,} → {len(df):,} unique sentences")

    # Stats
    n_scenario = df["meeting_id"].str.startswith(SCENARIO_PREFIXES).sum()
    print(f"\n  Scenario meetings: {df['meeting_id'].str.startswith(SCENARIO_PREFIXES).nunique()} "
          f"({n_scenario:,} sentences)")
    print(f"  Label distribution:")
    print(f"    Relevant: {df['is_relevant'].eq(1).sum():,} ({df['is_relevant'].eq(1).mean()*100:.1f}%)")
    print(f"    Noise:    {df['is_relevant'].eq(0).sum():,} ({df['is_relevant'].eq(0).mean()*100:.1f}%)")
    print(f"\n  Intent breakdown:")
    print(df["intent"].value_counts().to_string())

    # Add source column explicitly for cross-dataset training
    df["source"] = "ami"

    df.to_csv(output_path, index=False)
    print(f"\n✓ Saved {len(df):,} records → {output_path}")


if __name__ == "__main__":
    main()