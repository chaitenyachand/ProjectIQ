"""
ml/model_registry.py
Centralised model loading for FastAPI startup.

Resolution order (best → fallback):
  ST model  (artifacts/*.joblib)              — trained by training/run_all.py
  TF-IDF    (data/processed/models/*.joblib)  — trained by training/run_all.py --tfidf-only
  None      — API returns graceful degradation
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class ModelRegistry:
    def __init__(self):
        self._models: dict = {}

    def load_all(self):
        self._try_load("relevance", self._load_relevance)
        self._try_load("intent",    self._load_intent)
        self._try_load("delay",     self._load_delay)

    def _try_load(self, name: str, loader):
        try:
            self._models[name] = loader()
            logger.info(f"✓ {name} model loaded")
        except FileNotFoundError as e:
            logger.warning(f"⚠  {name} model not found — {e}")
        except Exception as e:
            logger.error(f"✗ Failed to load {name}: {e}")

    def _load_relevance(self):
        from ml.relevance_classifier import load_best
        return load_best()

    def _load_intent(self):
        from ml.intent_classifier import load_best
        return load_best()

    def _load_delay(self):
        from ml.delay_predictor import load, MODEL_PATH
        if not MODEL_PATH.exists():
            raise FileNotFoundError(f"Run: python3 training/run_all.py\nMissing: {MODEL_PATH}")
        return {"type": "delay", "model": load()}

    def get(self, name: str):
        return self._models.get(name)

    def loaded_model_names(self) -> list:
        return [f"{k}({v.get('type','?')})" for k, v in self._models.items()]