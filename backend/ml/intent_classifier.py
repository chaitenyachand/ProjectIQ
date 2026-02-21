"""
ml/intent_classifier.py
Multi-class intent: requirement | decision | action | timeline | stakeholder | noise

Supports two model formats:
  TF-IDF : data/processed/models/intent_tfidf.joblib + intent_encoder.joblib
  ST     : artifacts/intent_model_v1.joblib
"""

import logging
from pathlib import Path
import joblib
import pandas as pd
from sklearn.preprocessing import LabelEncoder
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer

logger = logging.getLogger(__name__)

TFIDF_PATH   = Path("data/processed/models/intent_tfidf.joblib")
ENCODER_PATH = Path("data/processed/models/intent_encoder.joblib")
ST_PATH      = Path("artifacts/intent_model_v1.joblib")

INTENT_LABELS = ["requirement", "decision", "action", "timeline", "stakeholder", "noise"]


def build_tfidf_pipeline() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 3), max_features=50_000,
                                  sublinear_tf=True, strip_accents="unicode")),
        ("clf",   CalibratedClassifierCV(
                      LinearSVC(C=0.5, max_iter=3000, class_weight="balanced"), cv=3)),
    ])


def train_tfidf(csv_path: str = "data/processed/all_sentences.csv"):
    df = pd.read_csv(csv_path)
    df = df[df["intent"].isin(INTENT_LABELS)].dropna(subset=["sentence"])

    # Oversample minority classes to 300 samples
    parts = []
    for cls in INTENT_LABELS:
        cls_df = df[df["intent"] == cls]
        if len(cls_df) == 0:
            continue
        if len(cls_df) < 300:
            cls_df = cls_df.sample(n=300, replace=True, random_state=42)
        parts.append(cls_df)
    df = pd.concat(parts).sample(frac=1, random_state=42)

    le = LabelEncoder()
    le.fit(INTENT_LABELS)
    X_train, X_test, y_train, y_test = train_test_split(
        df["sentence"].astype(str), le.transform(df["intent"]),
        test_size=0.2, random_state=42, stratify=le.transform(df["intent"])
    )
    pipeline = build_tfidf_pipeline()
    pipeline.fit(X_train, y_train)
    print(classification_report(y_test, pipeline.predict(X_test), target_names=le.classes_))
    TFIDF_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, TFIDF_PATH)
    joblib.dump(le, ENCODER_PATH)
    logger.info(f"✓ Saved TF-IDF intent → {TFIDF_PATH}")
    return pipeline, le


def _predict_tfidf(texts, pipeline, le):
    preds = pipeline.predict(texts)
    return [{"text": t, "intent": str(le.inverse_transform([p])[0])}
            for t, p in zip(texts, preds)]


def _predict_st(texts, artifact):
    from sentence_transformers import SentenceTransformer
    embedder = SentenceTransformer(artifact["embed_model"])
    X = embedder.encode(texts, batch_size=256, show_progress_bar=False,
                        convert_to_numpy=True, normalize_embeddings=True)
    preds  = artifact["classifier"].predict(X)
    labels = artifact["label_encoder"].inverse_transform(preds)
    return [{"text": t, "intent": str(label)} for t, label in zip(texts, labels)]


def load_best() -> dict:
    if ST_PATH.exists():
        import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
        from preprocessing.embedder import SentenceEmbedder  # noqa
        artifact = joblib.load(ST_PATH)
        logger.info(f"  intent: sentence-transformer ({ST_PATH})")
        return {"type": "st", "artifact": artifact}
    if TFIDF_PATH.exists() and ENCODER_PATH.exists():
        logger.info(f"  intent: TF-IDF ({TFIDF_PATH})")
        return {"type": "tfidf", "pipeline": joblib.load(TFIDF_PATH),
                "label_encoder": joblib.load(ENCODER_PATH)}
    raise FileNotFoundError(
        f"No intent model found. Checked:\n  {ST_PATH}\n  {TFIDF_PATH}\n"
        "Run: python3 training/run_all.py"
    )


def predict(texts: list, model_entry: dict) -> list:
    if not texts:
        return []
    if model_entry["type"] == "st":
        return _predict_st(texts, model_entry["artifact"])
    return _predict_tfidf(texts, model_entry["pipeline"], model_entry["label_encoder"])