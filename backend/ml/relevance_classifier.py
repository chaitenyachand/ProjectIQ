"""
ml/relevance_classifier.py
Binary classifier: is a sentence relevant to BRD extraction?

Supports two model formats — model_registry picks whichever is available:
  TF-IDF : data/processed/models/relevance_tfidf.joblib   (fast, ~2 min)
  ST     : artifacts/relevance_model_v1.joblib             (better quality)
"""

import logging
from pathlib import Path
import joblib
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer

logger = logging.getLogger(__name__)

TFIDF_PATH = Path("data/processed/models/relevance_tfidf.joblib")
ST_PATH    = Path("artifacts/relevance_model_v1.joblib")


def build_tfidf_pipeline() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), max_features=30_000,
                                  sublinear_tf=True, min_df=3, strip_accents="unicode")),
        ("clf",   LogisticRegression(C=1.0, max_iter=500, class_weight="balanced",
                                     solver="saga", n_jobs=-1)),
    ])


def train_tfidf(csv_path: str = "data/processed/all_sentences.csv") -> Pipeline:
    df = pd.read_csv(csv_path)
    df["is_relevant"] = pd.to_numeric(df["is_relevant"], errors="coerce")
    df = df[df["is_relevant"].isin([0, 1])].dropna(subset=["sentence"])
    X_train, X_test, y_train, y_test = train_test_split(
        df["sentence"].astype(str), df["is_relevant"].astype(int),
        test_size=0.2, random_state=42, stratify=df["is_relevant"]
    )
    pipeline = build_tfidf_pipeline()
    pipeline.fit(X_train, y_train)
    print(classification_report(y_test, pipeline.predict(X_test),
                                 target_names=["noise", "relevant"]))
    TFIDF_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, TFIDF_PATH)
    logger.info(f"✓ Saved TF-IDF relevance → {TFIDF_PATH}")
    return pipeline


def _predict_tfidf(texts, pipeline):
    probs = pipeline.predict_proba(texts)
    preds = pipeline.predict(texts)
    return [{"text": t, "is_relevant": int(p), "confidence": float(pr[p])}
            for t, p, pr in zip(texts, preds, probs)]


def _predict_st(texts, artifact):
    from sentence_transformers import SentenceTransformer
    embedder = SentenceTransformer(artifact["embed_model"])
    X = embedder.encode(texts, batch_size=256, show_progress_bar=False,
                        convert_to_numpy=True, normalize_embeddings=True)
    clf = artifact["classifier"]
    probs = clf.predict_proba(X)
    preds = clf.predict(X)
    return [{"text": t, "is_relevant": int(p), "confidence": float(pr[p])}
            for t, p, pr in zip(texts, preds, probs)]


def load_best() -> dict:
    """Called by model_registry — prefers ST model if available."""
    if ST_PATH.exists():
        import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
        from preprocessing.embedder import SentenceEmbedder  # noqa: needed for joblib
        artifact = joblib.load(ST_PATH)
        logger.info(f"  relevance: sentence-transformer ({ST_PATH})")
        return {"type": "st", "artifact": artifact}
    if TFIDF_PATH.exists():
        logger.info(f"  relevance: TF-IDF ({TFIDF_PATH})")
        return {"type": "tfidf", "pipeline": joblib.load(TFIDF_PATH)}
    raise FileNotFoundError(
        f"No relevance model found. Checked:\n  {ST_PATH}\n  {TFIDF_PATH}\n"
        "Run: python3 training/run_all.py"
    )


def predict(texts: list, model_entry: dict) -> list:
    """Unified predict — dispatches to correct backend."""
    if not texts:
        return []
    if model_entry["type"] == "st":
        return _predict_st(texts, model_entry["artifact"])
    return _predict_tfidf(texts, model_entry["pipeline"])