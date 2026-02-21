"""
agents/tools/sentiment_tool.py
Analyzes stakeholder sentiment across source communications using Claude.
"""

import json
import logging
import re

import anthropic

logger = logging.getLogger(__name__)
client = anthropic.Anthropic()


def analyze_stakeholder_sentiment(sources: list[dict]) -> dict:
    """
    Analyzes sentiment of stakeholders from source documents.

    Returns:
        overall: positive|neutral|negative|mixed
        score: 0.0–1.0 (0=very negative, 1=very positive)
        urgency: high|medium|low
        stakeholders: [{name, sentiment, key_concerns, supportive_of}]
        concerns: [{concern, mentioned_by, severity, quote}]
        positive_signals: [{signal, mentioned_by, quote}]
        recommendations: [str]
    """
    if not sources:
        return _empty_sentiment()

    source_text = "\n\n---\n\n".join([
        f"[{s.get('type', 'text').upper()}]"
        f"{' from ' + s.get('metadata', {}).get('from', '') if s.get('metadata', {}).get('from') else ''}\n"
        f"{str(s.get('content', ''))[:2000]}"
        for s in sources
    ])

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": f"""Analyze stakeholder sentiment in these business communications.

Return ONLY valid JSON:
{{
  "overall": "positive|neutral|negative|mixed",
  "score": 0.75,
  "urgency": "high|medium|low",
  "confidence_level": "high|medium|low",
  "stakeholders": [
    {{
      "name": "Name or role",
      "sentiment": "positive|neutral|negative",
      "key_concerns": ["Concern 1"],
      "supportive_of": ["Feature or requirement they support"]
    }}
  ],
  "concerns": [
    {{
      "concern": "Description",
      "mentioned_by": "Name or 'multiple'",
      "severity": "high|medium|low",
      "quote": "Brief quote (under 80 chars)"
    }}
  ],
  "positive_signals": [
    {{
      "signal": "Description",
      "mentioned_by": "Name",
      "quote": "Brief quote (under 80 chars)"
    }}
  ],
  "recommendations": ["Actionable recommendation based on sentiment"]
}}

SOURCES:
{source_text[:40000]}""",
        }],
    )

    raw = message.content[0].text.strip()
    raw = _strip_fences(raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning(f"Sentiment parse error: {e}")
        return _empty_sentiment()


def _empty_sentiment() -> dict:
    return {
        "overall": "neutral",
        "score": 0.5,
        "urgency": "medium",
        "confidence_level": "low",
        "stakeholders": [],
        "concerns": [],
        "positive_signals": [],
        "recommendations": ["Insufficient data for sentiment analysis"],
    }


def _strip_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    return text.strip()
