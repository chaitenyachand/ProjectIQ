"""
download_ami.py
───────────────
Download the AMI Meeting Corpus from HuggingFace.

Output: data/raw/ami/ami_data.json

Usage:
  python3 preprocessing/download_ami.py
"""

import json
import sys
from pathlib import Path

ROOT    = Path(__file__).parent.parent
OUT_DIR = ROOT / "data" / "raw" / "ami"
OUT_FILE = OUT_DIR / "ami_data.json"

def main():
    try:
        from datasets import load_dataset
    except ImportError:
        print("Installing 'datasets' library...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "datasets", "-q"])
        from datasets import load_dataset

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Downloading AMI Meeting Corpus from HuggingFace...")
    print("(knkarthick/AMI — CC BY 4.0)")
    print()

    try:
        ds = load_dataset("knkarthick/AMI", trust_remote_code=True)
    except Exception as e:
        print(f"✗ Failed: {e}")
        print()
        print("Try manually:")
        print("  pip install datasets huggingface_hub")
        print("  python3 -c \"from datasets import load_dataset; load_dataset('knkarthick/AMI')\"")
        sys.exit(1)

    all_records = []
    for split in ds:
        for record in ds[split]:
            record = dict(record)
            record["_split"] = split
            all_records.append(record)

    with open(OUT_FILE, "w") as f:
        json.dump(all_records, f, indent=2)

    split_counts = {s: len(ds[s]) for s in ds}
    print(f"✓ Downloaded {len(all_records)} records → {OUT_FILE}")
    print(f"  Splits: {split_counts}")
    print()
    print("Now run: python3 preprocessing/run_all.py --skip-enron --skip-meetings")

if __name__ == "__main__":
    main()