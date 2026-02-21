"""
train_embeddings.py
───────────────────
Pre-compute and cache sentence embeddings for the full dataset.

Why:  Training relevance + intent + timeline all re-embed the same sentences.
      This script embeds everything once and saves to disk. Other training
      scripts can load cached embeddings for 10x faster iteration.

Output:
  artifacts/embeddings_v1/
    embeddings.npy      — float32 array (N, 384)
    sentence_ids.npy    — str array of sentence_ids (N,)
    sentences.npy       — str array of sentence texts (N,)
    metadata.json       — embed model, shape, date, etc.

Usage:
  python3 training/train_embeddings.py
  python3 training/train_embeddings.py --quick   # first 5000 rows
  python3 training/train_embeddings.py --force   # recompute even if cached
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

ROOT      = Path(__file__).parent.parent
DATA_PATH = ROOT / "data" / "processed" / "all_sentences.csv"
OUT_DIR   = ROOT / "artifacts" / "embeddings_v1"

EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BATCH_SIZE  = 512   # larger batches = faster on GPU/MPS; safe on CPU too
RANDOM_SEED = 42


def load_sentences(csv_path: Path, quick: bool = False):
    """Load sentence texts and IDs."""
    print(f"  Loading sentences from {csv_path}")
    df = pd.read_csv(csv_path, dtype=str).fillna("")

    if quick:
        df = df.head(5000)
        print(f"  Quick mode: using first 5,000 rows")

    sentence_ids = df["sentence_id"].tolist()
    sentences    = df["sentence"].tolist()

    print(f"  Loaded {len(sentences):,} sentences")
    return sentence_ids, sentences


def embed_all(sentences: list[str]) -> np.ndarray:
    """Embed all sentences using all-MiniLM-L6-v2. Returns float32 (N, 384)."""
    print(f"\n  Loading embedding model: {EMBED_MODEL}")
    model = SentenceTransformer(EMBED_MODEL)

    print(f"  Embedding {len(sentences):,} sentences (batch_size={BATCH_SIZE})...")
    embeddings = model.encode(
        sentences,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,   # L2-normalized for cosine similarity
    )

    print(f"  Done. Shape: {embeddings.shape}, dtype: {embeddings.dtype}")
    return embeddings.astype(np.float32)


def save_embeddings(
    out_dir: Path,
    embeddings: np.ndarray,
    sentence_ids: list[str],
    sentences: list[str],
):
    out_dir.mkdir(parents=True, exist_ok=True)

    np.save(out_dir / "embeddings.npy",   embeddings)
    np.save(out_dir / "sentence_ids.npy", np.array(sentence_ids, dtype=object))
    np.save(out_dir / "sentences.npy",    np.array(sentences, dtype=object))

    metadata = {
        "embed_model":    EMBED_MODEL,
        "shape":          list(embeddings.shape),
        "normalized":     True,
        "n_sentences":    len(sentences),
        "embedding_dim":  embeddings.shape[1],
        "created_at":     datetime.utcnow().isoformat(),
        "version":        "v1",
        "usage": {
            "load_embeddings": "np.load('embeddings.npy')",
            "load_ids":        "np.load('sentence_ids.npy', allow_pickle=True)",
            "similarity":      "np.dot(query_embed, embeddings.T)  # cosine (normalized)",
        }
    }

    with open(out_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"\n  Saved:")
    print(f"    embeddings.npy   — {embeddings.nbytes / 1e6:.1f} MB")
    print(f"    sentence_ids.npy")
    print(f"    sentences.npy")
    print(f"    metadata.json")


def verify_embeddings(out_dir: Path):
    """Quick sanity check: load and compute a similarity."""
    print("\n  Verifying saved embeddings...")
    E = np.load(out_dir / "embeddings.npy")
    sids = np.load(out_dir / "sentence_ids.npy", allow_pickle=True)
    sents = np.load(out_dir / "sentences.npy", allow_pickle=True)

    assert E.shape[0] == len(sids) == len(sents), "Shape mismatch!"

    # Spot check: first sentence should be most similar to itself
    q = E[0]
    sims = np.dot(q, E[:100].T)
    top_idx = np.argmax(sims)
    assert top_idx == 0, f"Self-similarity check failed (top match was index {top_idx})"

    print(f"  ✓ Shape: {E.shape} — verified OK")


def main():
    ap = argparse.ArgumentParser(description="Pre-compute sentence embeddings")
    ap.add_argument("--input",   default=str(DATA_PATH))
    ap.add_argument("--output",  default=str(OUT_DIR))
    ap.add_argument("--quick",   action="store_true")
    ap.add_argument("--force",   action="store_true",
                    help="Recompute even if cached embeddings exist")
    args = ap.parse_args()

    out_dir   = Path(args.output)
    data_path = Path(args.input)

    OUT_DIR.parent.mkdir(parents=True, exist_ok=True)

    # Check cache
    if not args.force and (out_dir / "embeddings.npy").exists():
        meta_path = out_dir / "metadata.json"
        if meta_path.exists():
            with open(meta_path) as f:
                meta = json.load(f)
            print(f"✓ Cached embeddings found: {meta['n_sentences']:,} sentences "
                  f"({meta['embedding_dim']}d, {meta['created_at'][:10]})")
            print("  Use --force to recompute.")
            return

    if not data_path.exists():
        print(f"✗ Data not found: {data_path}")
        print("  Run preprocessing/run_all.py first.")
        sys.exit(1)

    print("=" * 60)
    print("  Pre-computing Sentence Embeddings")
    print("=" * 60)

    sentence_ids, sentences = load_sentences(data_path, quick=args.quick)
    embeddings = embed_all(sentences)
    save_embeddings(out_dir, embeddings, sentence_ids, sentences)
    verify_embeddings(out_dir)

    print(f"\n✓ Embeddings ready → {out_dir}")
    print("  Next: python3 training/run_all.py --use-cache")


if __name__ == "__main__":
    main()