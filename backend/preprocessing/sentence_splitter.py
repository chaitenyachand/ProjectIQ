"""
sentence_splitter.py
────────────────────
Shared sentence segmentation utility for BRD Agent ML pipeline.

Splits raw text into clean, labeled sentence records with metadata.
Used by parse_enron.py, parse_ami.py, and parse_meetings.py.
"""

import re
import hashlib
from typing import Iterator
from dataclasses import dataclass, field, asdict

import nltk
from nltk.tokenize import sent_tokenize

# Ensure NLTK data is available
for _pkg in ["punkt", "punkt_tab"]:
    try:
        nltk.data.find(f"tokenizers/{_pkg}")
    except LookupError:
        nltk.download(_pkg, quiet=True)


# ─── Data model ───────────────────────────────────────────────────────────────

@dataclass
class SentenceRecord:
    """One sentence extracted from a source document."""
    sentence_id: str          # SHA1 hash of (source + text) for dedup
    source: str               # "enron" | "ami" | "meetings"
    doc_id: str               # original document/email/transcript ID
    sentence: str             # cleaned sentence text
    char_count: int = 0
    word_count: int = 0

    # Optional metadata (populated per-source)
    speaker: str = ""         # AMI/meetings: who said it
    timestamp: str = ""       # email date or meeting timestamp
    subject: str = ""         # email subject or meeting title
    sender: str = ""          # email from field
    recipients: str = ""      # email to/cc (comma-joined)
    meeting_id: str = ""      # AMI meeting ID

    # Labels (filled during labeling step)
    is_relevant: int = -1     # 1=relevant to BRD, 0=noise, -1=unlabeled
    intent: str = ""          # requirement|decision|action|timeline|stakeholder|noise
    has_timeline: int = -1    # 1=contains date/deadline mention, 0=no, -1=unlabeled

    def __post_init__(self):
        self.char_count = len(self.sentence)
        self.word_count = len(self.sentence.split())
        if not self.sentence_id:
            self.sentence_id = _make_id(self.source, self.doc_id, self.sentence)

    def to_dict(self) -> dict:
        return asdict(self)


def _make_id(source: str, doc_id: str, text: str) -> str:
    payload = f"{source}::{doc_id}::{text[:200]}"
    return hashlib.sha1(payload.encode()).hexdigest()[:16]


# ─── Core cleaning ────────────────────────────────────────────────────────────

# Patterns to strip before splitting
_STRIP_PATTERNS = [
    re.compile(r"^>+.*$", re.MULTILINE),            # email reply quotes
    re.compile(r"-{3,}.*?-{3,}", re.DOTALL),        # horizontal rules
    re.compile(r"={3,}"),                            # === separators
    re.compile(r"^From:.*$", re.MULTILINE),          # email headers
    re.compile(r"^Sent:.*$", re.MULTILINE),
    re.compile(r"^To:.*$", re.MULTILINE),
    re.compile(r"^Cc:.*$", re.MULTILINE),
    re.compile(r"^Subject:.*$", re.MULTILINE),
    re.compile(r"^Date:.*$", re.MULTILINE),
    re.compile(r"\[.*?\]"),                          # [bracketed metadata]
    re.compile(r"http\S+"),                          # URLs
    re.compile(r"\S+@\S+\.\S+"),                     # emails in body
    re.compile(r"\r\n|\r"),                          # CRLF → LF
]

# Sentences to skip entirely
_SKIP_PATTERNS = [
    re.compile(r"^\s*$"),                            # blank
    re.compile(r"^[\W\d\s]{,10}$"),                 # only symbols/numbers
    re.compile(r"^(thanks|regards|best|cheers|hi|hello|dear)\b", re.I),
    re.compile(r"^\d+[\.\)]\s*$"),                  # bare numbered list markers
    re.compile(r"confidential|disclaimer|unsubscribe", re.I),
]

# Timeline signal (for auto-labeling)
_TIMELINE_RE = re.compile(
    r"\b("
    r"by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|"
    r"by\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*|"
    r"deadline|due\s+date|due\s+by|no\s+later\s+than|"
    r"end\s+of\s+(week|month|quarter|year|day)|eow|eom|eoq|eoy|"
    r"next\s+(week|month|quarter|sprint|release)|"
    r"by\s+Q[1-4]|Q[1-4]\s+\d{4}|"
    r"\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|"
    r"(january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2}"
    r")\b",
    re.I
)

# BRD-relevance signals (keyword heuristics for weak labeling)
_RELEVANCE_KEYWORDS = re.compile(
    r"\b("
    r"require[sd]?|requirement|must\s+(have|be|include|support)|"
    r"shall|should\s+be|need[sd]?\s+to|critical|mandatory|"
    r"decided|decision|agreed|approved|approved\s+by|sign[- ]?off|"
    r"action\s+item|follow\s+up|deliverable|milestone|"
    r"stakeholder|sponsor|owner|responsible|assigned\s+to|"
    r"scope|objective|constraint|assumption|dependency|"
    r"feature|functionality|specification|spec|"
    r"timeline|schedule|roadmap|release|launch|go[-\s]live"
    r")\b",
    re.I
)

_INTENT_PATTERNS = [
    ("requirement",  re.compile(r"\b(require[sd]?|must\s+have|shall|should\s+be|mandatory|critical)\b", re.I)),
    ("decision",     re.compile(r"\b(decided|decision|agreed|approved|sign.?off|conclusion)\b", re.I)),
    ("action",       re.compile(r"\b(action\s+item|follow\s+up|will\s+be|please\s+\w+|assigned\s+to)\b", re.I)),
    ("timeline",     _TIMELINE_RE),
    ("stakeholder",  re.compile(r"\b(stakeholder|sponsor|owner|manager|director|vp|ceo|cto|committee)\b", re.I)),
]


def clean_text(text: str) -> str:
    """Strip boilerplate and normalize whitespace."""
    for pattern in _STRIP_PATTERNS:
        text = pattern.sub(" ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def should_skip(sentence: str) -> bool:
    """Return True if sentence should be discarded."""
    s = sentence.strip()
    if len(s) < 20 or len(s) > 1000:
        return True
    if len(s.split()) < 4:
        return True
    for pat in _SKIP_PATTERNS:
        if pat.search(s):
            return True
    return False


def auto_label(sentence: str) -> dict:
    """
    Heuristic weak labels. These are starting points — not ground truth.
    The label_data.py script can refine or override these.
    """
    is_relevant = 1 if _RELEVANCE_KEYWORDS.search(sentence) else 0
    has_timeline = 1 if _TIMELINE_RE.search(sentence) else 0

    intent = "noise"
    if is_relevant:
        for label, pat in _INTENT_PATTERNS:
            if pat.search(sentence):
                intent = label
                break
        if intent == "noise":
            intent = "requirement"  # default relevant bucket

    return {
        "is_relevant": is_relevant,
        "has_timeline": has_timeline,
        "intent": intent,
    }


# ─── Main splitter ────────────────────────────────────────────────────────────

def split_into_sentences(
    text: str,
    source: str,
    doc_id: str,
    metadata: dict | None = None,
    apply_auto_labels: bool = True,
) -> Iterator[SentenceRecord]:
    """
    Clean text and yield SentenceRecord objects.

    Args:
        text:               Raw document text
        source:             "enron" | "ami" | "meetings"
        doc_id:             Unique ID for the source document
        metadata:           Dict with optional fields: speaker, timestamp,
                            subject, sender, recipients, meeting_id
        apply_auto_labels:  If True, populate is_relevant/intent/has_timeline
                            using keyword heuristics (weak labels)

    Yields:
        SentenceRecord for each kept sentence
    """
    meta = metadata or {}
    cleaned = clean_text(text)

    if not cleaned.strip():
        return

    try:
        sentences = sent_tokenize(cleaned)
    except Exception:
        # Fallback: split on periods
        sentences = [s.strip() for s in cleaned.split(".") if s.strip()]

    for raw_sent in sentences:
        sent = raw_sent.strip()
        if should_skip(sent):
            continue

        record = SentenceRecord(
            sentence_id="",  # computed in __post_init__
            source=source,
            doc_id=doc_id,
            sentence=sent,
            speaker=meta.get("speaker", ""),
            timestamp=meta.get("timestamp", ""),
            subject=meta.get("subject", ""),
            sender=meta.get("sender", ""),
            recipients=meta.get("recipients", ""),
            meeting_id=meta.get("meeting_id", ""),
        )

        if apply_auto_labels:
            labels = auto_label(sent)
            record.is_relevant = labels["is_relevant"]
            record.has_timeline = labels["has_timeline"]
            record.intent = labels["intent"]

        yield record


def records_to_dataframe(records: list[SentenceRecord]):
    """Convert list of SentenceRecord to a pandas DataFrame."""
    import pandas as pd
    return pd.DataFrame([r.to_dict() for r in records])