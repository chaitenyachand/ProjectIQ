"""
parse_meetings.py
─────────────────
Parse the Kaggle Meeting Transcripts dataset into sentence records.

Dataset schema (city council meetings):
  id, Item_UID, Meeting_UID, Transcript, Summary, Date

Each row has:
  - Transcript: full multi-speaker transcript ("Speaker 2: ...")
  - Summary:    abstractive summary (used as ground-truth relevant signal)
  - Meeting_UID: e.g. "LongBeachCC_01072014"

The parser:
  1. Processes Transcript — splits by speaker turn, then into sentences
  2. Processes Summary — force-labeled as relevant (ground truth)
  3. Auto-detects columns for robustness across train/test/validation splits

Input:  data/raw/meetings/*.csv
Output: data/processed/meetings_sentences.csv

Usage:
  python3 preprocessing/parse_meetings.py
  python3 preprocessing/parse_meetings.py --input data/raw/meetings/
"""

import argparse
import re
import sys
from pathlib import Path

import pandas as pd
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).parent.parent))
from preprocessing.sentence_splitter import split_into_sentences, SentenceRecord

ROOT     = Path(__file__).parent.parent
RAW_DIR  = ROOT / "data" / "raw" / "meetings"
OUT_PATH = ROOT / "data" / "processed" / "meetings_sentences.csv"


# ─── Column detection ─────────────────────────────────────────────────────────

TEXT_COLS      = ["transcript", "text", "content", "dialogue", "speech", "utterance", "message"]
SUMMARY_COLS   = ["summary", "abstract", "description"]
SPEAKER_COLS   = ["speaker", "name", "participant", "who", "author", "person"]
ID_COLS        = ["meeting_uid", "meeting_id", "id", "item_uid", "filename", "file", "session"]
TIMESTAMP_COLS = ["date", "timestamp", "time", "start_time", "created_at"]


def detect_column(df_cols: list, candidates: list):
    lower = {c.lower(): c for c in df_cols}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return None


# ─── Speaker turn splitter ────────────────────────────────────────────────────

# Matches "Speaker 2: ", "SPEAKER_NAME: ", "John Smith: " etc.
_SPEAKER_RE = re.compile(r'^([A-Z][A-Za-z0-9 _]{0,40}):\s+', re.MULTILINE)


def split_by_speaker(transcript: str) -> list[tuple[str, str]]:
    """
    Split transcript into (speaker, text) turns.
    Falls back to treating whole transcript as one turn if no speaker markers found.
    """
    matches = list(_SPEAKER_RE.finditer(transcript))
    if not matches:
        return [("", transcript)]

    turns = []
    for i, match in enumerate(matches):
        speaker = match.group(1).strip()
        start   = match.end()
        end     = matches[i + 1].start() if i + 1 < len(matches) else len(transcript)
        text    = transcript[start:end].strip()
        if text:
            turns.append((speaker, text))
    return turns


# ─── CSV parser ───────────────────────────────────────────────────────────────

def parse_csv_file(csv_path: Path, file_idx: int) -> list[SentenceRecord]:
    """Parse one meetings CSV into sentence records."""
    if csv_path.stat().st_size < 50:
        print(f"  ⚠ Skipping empty file: {csv_path.name}")
        return []

    try:
        df = pd.read_csv(csv_path, dtype=str).fillna("")
        if df.empty or len(df.columns) == 0:
            print(f"  ⚠ No data in {csv_path.name}, skipping")
            return []
    except Exception as e:
        print(f"  ⚠ Could not read {csv_path.name}: {e}")
        return []

    cols = list(df.columns)
    text_col      = detect_column(cols, TEXT_COLS)
    summary_col   = detect_column(cols, SUMMARY_COLS)
    id_col        = detect_column(cols, ID_COLS)
    timestamp_col = detect_column(cols, TIMESTAMP_COLS)

    if not text_col and not summary_col:
        # Last resort: use the widest string column
        str_cols = df.select_dtypes(include="object").columns.tolist()
        if str_cols:
            text_col = max(str_cols, key=lambda c: df[c].str.len().mean())
            print(f"  ⚠ No transcript column in {csv_path.name}; using '{text_col}'")
        else:
            print(f"  ✗ No usable text column in {csv_path.name} — skipping")
            return []

    stem    = csv_path.stem
    records = []

    for row_idx, row in df.iterrows():
        meeting_id = row.get(id_col, "")   if id_col        else ""
        timestamp  = row.get(timestamp_col, "") if timestamp_col else ""
        if not meeting_id:
            meeting_id = f"{stem}_row{row_idx}"

        # ── Process Transcript (speaker-by-speaker) ─────────────────────
        if text_col:
            transcript = row.get(text_col, "")
            if transcript and len(transcript.strip()) > 20:
                turns = split_by_speaker(transcript)
                for speaker, turn_text in turns:
                    doc_id = f"meetings__{meeting_id}__{row_idx}__{speaker[:20]}"
                    metadata = {
                        "speaker":    speaker,
                        "timestamp":  timestamp,
                        "meeting_id": meeting_id,
                        "subject":    f"Meeting: {meeting_id}",
                    }
                    for rec in split_into_sentences(
                        text=turn_text,
                        source="meetings",
                        doc_id=doc_id,
                        metadata=metadata,
                        apply_auto_labels=True,
                    ):
                        records.append(rec)

        # ── Process Summary (ground-truth relevant) ─────────────────────
        if summary_col:
            summary = row.get(summary_col, "")
            if summary and len(summary.strip()) > 30:
                doc_id = f"meetings__{meeting_id}__{row_idx}__summary"
                metadata = {
                    "speaker":    "SUMMARY",
                    "timestamp":  timestamp,
                    "meeting_id": meeting_id,
                    "subject":    f"Meeting Summary: {meeting_id}",
                }
                for rec in split_into_sentences(
                    text=summary,
                    source="meetings",
                    doc_id=doc_id,
                    metadata=metadata,
                    apply_auto_labels=True,
                ):
                    # Summaries are definitionally relevant
                    rec.is_relevant = 1
                    if rec.intent == "noise":
                        rec.intent = "requirement"
                    records.append(rec)

    return records


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Parse Meeting Transcripts → sentence CSV")
    parser.add_argument("--input",  default=str(RAW_DIR),  help="Dir of meeting CSVs (or single CSV)")
    parser.add_argument("--output", default=str(OUT_PATH), help="Output CSV path")
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if input_path.is_dir():
        csv_files = sorted(input_path.glob("*.csv"))
    elif input_path.suffix.lower() == ".csv":
        csv_files = [input_path]
    else:
        csv_files = []

    if not csv_files:
        print(f"✗ No CSV files found at {input_path}")
        sys.exit(1)

    print(f"Parsing Meeting Transcripts (city council meetings)...")
    print(f"  Input dir: {input_path}")
    print(f"  CSV files: {[f.name for f in csv_files]}")
    print(f"  Output:    {output_path}")

    all_sentences: list[SentenceRecord] = []
    for i, csv_file in enumerate(tqdm(csv_files, desc="Meeting files", unit="file")):
        sentences = parse_csv_file(csv_file, i)
        all_sentences.extend(sentences)
        tqdm.write(f"  {csv_file.name}: {len(sentences):,} sentences")

    if not all_sentences:
        print("✗ No sentences produced.")
        sys.exit(1)

    df = pd.DataFrame([r.to_dict() for r in all_sentences])
    before = len(df)
    df = df.drop_duplicates(subset=["sentence_id"])
    print(f"\n  Deduped: {before:,} → {len(df):,} unique sentences")

    # Stats
    transcript_rows = df[df["speaker"] != "SUMMARY"]
    summary_rows    = df[df["speaker"] == "SUMMARY"]
    print(f"  Transcript sentences: {len(transcript_rows):,}")
    print(f"  Summary sentences:    {len(summary_rows):,}  (force-labeled relevant)")
    print(f"\n  Label distribution:")
    print(f"    Relevant: {df['is_relevant'].eq(1).sum():,} ({df['is_relevant'].eq(1).mean()*100:.1f}%)")
    print(f"    Noise:    {df['is_relevant'].eq(0).sum():,} ({df['is_relevant'].eq(0).mean()*100:.1f}%)")
    print(f"\n  Intent breakdown:")
    print(df["intent"].value_counts().to_string())

    df.to_csv(output_path, index=False)
    print(f"\n✓ Saved {len(df):,} records → {output_path}")


if __name__ == "__main__":
    main()