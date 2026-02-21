"""
ml/features.py
Shared feature engineering for all ML models.

Source priority (updated per mentor feedback):
  1. document   — highest: formal uploaded specs / PRDs
  2. transcript — second:  live stakeholder meeting recordings
  3. email      — supporting: Gmail threads
  4. slack      — lowest:  high noise, low signal per message
"""

import re
import numpy as np
import pandas as pd
from datetime import datetime, timezone


# ── Source type priority weights ──────────────────────────────────────────────
# Multiplied against ML confidence score before threshold check.
# Documents are #1 — they are deliberate, structured, written for purpose.
# Transcripts are #2 — rich but verbose and informal.

SOURCE_PRIORITY_WEIGHTS = {
    "document":   1.00,  # ← HIGHEST — uploaded PDFs, Word docs, spec sheets
    "transcript": 0.90,  # ← 2nd    — Fireflies / meeting recordings
    "email":      0.65,  # ← 3rd    — Gmail threads
    "slack":      0.50,  # ← LOWEST — Slack (most noise)
}

# Sort order for UI cards and agent prompt (0 = first)
SOURCE_DISPLAY_ORDER = {
    "document":   0,
    "transcript": 1,
    "email":      2,
    "slack":      3,
}

# Label sent to Claude inside the agent prompt
SOURCE_PRIORITY_LABELS = {
    "document":   "PRIMARY",    # extract from these first
    "transcript": "PRIMARY",    # extract from these first
    "email":      "SUPPORTING", # use for context only
    "slack":      "SUPPORTING", # use for context only
}


def apply_source_weight(ml_confidence: float, source_type: str) -> float:
    """
    Multiply ML relevance score by source type weight.
    Documents and transcripts are boosted; Slack is penalised.
    """
    weight = SOURCE_PRIORITY_WEIGHTS.get(source_type.lower(), 0.60)
    return min(ml_confidence * weight, 1.0)


def sort_sources_by_priority(sources: list[dict]) -> list[dict]:
    """
    Sort sources for the agent prompt:
      documents first → transcripts → emails → slack
    Within each tier, sort by relevance_score descending.
    """
    return sorted(
        sources,
        key=lambda s: (
            SOURCE_DISPLAY_ORDER.get(s.get("type", "slack").lower(), 4),
            -s.get("relevance_score", 0.5),
        ),
    )


def get_priority_label(source_type: str) -> str:
    """Return PRIMARY or SUPPORTING for a given source type."""
    return SOURCE_PRIORITY_LABELS.get(source_type.lower(), "SUPPORTING")


def should_always_include(source_type: str) -> bool:
    """
    Documents and transcripts always pass the ML filter regardless of score.
    Emails and Slack must earn their way past the relevance threshold.
    """
    return source_type.lower() in ("document", "transcript")
