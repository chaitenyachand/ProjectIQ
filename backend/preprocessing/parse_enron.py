"""
parse_enron.py
──────────────
Parse the Enron Email Dataset (emails.csv from Kaggle) into sentence records.

Input:  data/raw/enron/emails.csv
Output: data/processed/enron_sentences.csv

The Enron CSV has two columns:
  file    — path like "maildir/allen-p/inbox/1."
  message — full RFC-822 email text (headers + body)

Usage:
  python3 preprocessing/parse_enron.py
  python3 preprocessing/parse_enron.py --limit 5000   # quick smoke test
  python3 preprocessing/parse_enron.py --input path/to/emails.csv
"""

import argparse
import email
import sys
from pathlib import Path
from typing import Iterator

import pandas as pd
from tqdm import tqdm

# Allow imports from ml/ root
sys.path.insert(0, str(Path(__file__).parent.parent))
from preprocessing.sentence_splitter import split_into_sentences, SentenceRecord

# ─── Paths ───────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
RAW_ENRON = ROOT / "data" / "raw" / "enron" / "emails.csv"
OUT_PATH = ROOT / "data" / "processed" / "enron_sentences.csv"


# ─── Email parsing ────────────────────────────────────────────────────────────

def parse_enron_message(raw_message: str) -> dict:
    """Parse a raw RFC-822 email string into header fields + body."""
    try:
        msg = email.message_from_string(raw_message)
    except Exception:
        return {}

    def _header(key: str) -> str:
        val = msg.get(key, "") or ""
        return str(val).strip()

    # Extract body
    body = ""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype == "text/plain":
                try:
                    body += part.get_payload(decode=True).decode("utf-8", errors="replace")
                except Exception:
                    body += str(part.get_payload())
    else:
        try:
            body = msg.get_payload(decode=True).decode("utf-8", errors="replace")
        except Exception:
            body = str(msg.get_payload())

    return {
        "subject":    _header("Subject"),
        "sender":     _header("From"),
        "recipients": _header("To") + ("," + _header("Cc") if _header("Cc") else ""),
        "timestamp":  _header("Date"),
        "body":       body,
    }


def enron_records(csv_path: Path, limit: int | None = None) -> Iterator[SentenceRecord]:
    """
    Stream sentence records from the Enron CSV.
    Skips emails with empty bodies or very short content.
    """
    print(f"  Reading {csv_path} ...")

    reader = pd.read_csv(csv_path, chunksize=2000, dtype=str)
    total_emails = 0
    total_sentences = 0

    for chunk in reader:
        chunk = chunk.fillna("")
        for _, row in chunk.iterrows():
            if limit and total_emails >= limit:
                return

            file_path = row.get("file", "")
            raw_msg   = row.get("message", "")

            if not raw_msg.strip():
                continue

            parsed = parse_enron_message(raw_msg)
            if not parsed or len(parsed.get("body", "")) < 50:
                continue

            doc_id = file_path.replace("/", "__").replace(" ", "_") or f"enron_{total_emails}"
            metadata = {
                "subject":    parsed["subject"],
                "sender":     parsed["sender"],
                "recipients": parsed["recipients"],
                "timestamp":  parsed["timestamp"],
            }

            for record in split_into_sentences(
                text=parsed["body"],
                source="enron",
                doc_id=doc_id,
                metadata=metadata,
                apply_auto_labels=True,
            ):
                total_sentences += 1
                yield record

            total_emails += 1

    print(f"  Processed {total_emails:,} emails → {total_sentences:,} sentences")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Parse Enron emails → sentence CSV")
    parser.add_argument("--input",  default=str(RAW_ENRON), help="Path to emails.csv")
    parser.add_argument("--output", default=str(OUT_PATH),  help="Output CSV path")
    parser.add_argument("--limit",  type=int, default=None, help="Max emails to process (for testing)")
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"✗ Enron CSV not found at {input_path}")
        print("  Run setup_datasets.sh first, or pass --input /path/to/emails.csv")
        sys.exit(1)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Parsing Enron emails...")
    print(f"  Input:  {input_path}")
    print(f"  Output: {output_path}")
    if args.limit:
        print(f"  Limit:  {args.limit:,} emails")

    records = list(tqdm(enron_records(input_path, limit=args.limit),
                        desc="Enron sentences", unit="sent"))

    if not records:
        print("✗ No records produced. Check the input file format.")
        sys.exit(1)

    df = pd.DataFrame([r.to_dict() for r in records])

    # Dedup by sentence_id
    before = len(df)
    df = df.drop_duplicates(subset=["sentence_id"])
    print(f"  Deduped: {before:,} → {len(df):,} unique sentences")

    # Stats
    print(f"\n  Label distribution:")
    print(f"    Relevant:  {df['is_relevant'].eq(1).sum():,} ({df['is_relevant'].eq(1).mean()*100:.1f}%)")
    print(f"    Noise:     {df['is_relevant'].eq(0).sum():,} ({df['is_relevant'].eq(0).mean()*100:.1f}%)")
    print(f"\n  Intent breakdown:")
    print(df["intent"].value_counts().to_string())

    df.to_csv(output_path, index=False)
    print(f"\n✓ Saved {len(df):,} records → {output_path}")

    # Also save a labeled subset for quick training
    labeled_path = output_path.parent / "enron_labeled.csv"
    labeled_df = df[df["is_relevant"] != -1]
    labeled_df.to_csv(labeled_path, index=False)
    print(f"✓ Labeled subset: {len(labeled_df):,} records → {labeled_path}")


if __name__ == "__main__":
    main()