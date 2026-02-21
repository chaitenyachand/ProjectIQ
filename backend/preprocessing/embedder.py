"""
embedder.py
───────────
Shared SentenceEmbedder class — must live in a stable module path
so joblib can unpickle it correctly regardless of which script trained it.

Import this everywhere instead of defining SentenceEmbedder inline.
"""

import numpy as np
from sentence_transformers import SentenceTransformer

EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
BATCH_SIZE  = 256


class SentenceEmbedder:
    """Wraps SentenceTransformer for joblib serialization and sklearn pipelines."""

    def __init__(self, model_name: str = EMBED_MODEL):
        self.model_name = model_name
        self._model = None

    def _load(self):
        if self._model is None:
            self._model = SentenceTransformer(self.model_name)

    def fit(self, X, y=None):
        self._load()
        return self

    def transform(self, sentences, batch_size: int = BATCH_SIZE) -> np.ndarray:
        self._load()
        return self._model.encode(
            sentences,
            batch_size=batch_size,
            show_progress_bar=True,
            convert_to_numpy=True,
            normalize_embeddings=True,
        )

    def fit_transform(self, X, y=None):
        return self.fit(X, y).transform(X)

    # Make pickling/unpickling work correctly
    def __getstate__(self):
        state = self.__dict__.copy()
        state["_model"] = None   # don't pickle the model weights
        return state

    def __setstate__(self, state):
        self.__dict__.update(state)
        self._model = None       # will be lazy-loaded on next call