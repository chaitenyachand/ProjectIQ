"""
agents/tools/extract_tool.py
Uses Claude claude-sonnet-4-20250514 to extract structured BRD sections
from pre-filtered source text.

Mentor suggestions implemented:
  #2 — Anti-hallucination: every requirement source_quote validated
       against actual source text. Unverifiable quotes flagged.
  #3 — Transcripts first: sorted to top of context, labelled PRIMARY.
"""

import json
import logging
import re

import anthropic

logger = logging.getLogger(__name__)
client = anthropic.Anthropic()


def extract_requirements(sources: list[dict]) -> dict:
    relevant = [s for s in sources if s.get("relevance_score", 1.0) > 0.25]
    if not relevant:
        relevant = sources

    # Mentor #3: transcripts first
    from ml.features import sort_sources_by_priority
    relevant = sort_sources_by_priority(relevant)

    combined_parts = []
    for s in relevant:
        source_type  = s.get("type", "text").upper()
        score        = s.get("relevance_score", 1.0)
        subject      = (s.get("metadata") or {}).get("subject", "")
        priority_tag = "PRIMARY" if s.get("type") == "transcript" else "SUPPORTING"
        header = f"[{source_type} | {priority_tag} | score={score:.2f}]"
        if subject:
            header += f" | {subject}"
        combined_parts.append(f"{header}\n{str(s.get('content', ''))}")

    combined = "\n\n---SOURCE BREAK---\n\n".join(combined_parts)

    # Mentor #2: strict anti-hallucination system prompt
    system = """You are a senior business analyst extracting a BRD.

CRITICAL ANTI-HALLUCINATION RULES:
1. Every requirement MUST have a source_quote field.
2. source_quote MUST be VERBATIM from the source text — exact words only.
3. If no exact quote exists for a requirement, DO NOT include it.
4. Never invent or paraphrase requirements not explicitly in the sources.
5. Sources labelled PRIMARY (transcripts) take precedence over SUPPORTING.
6. Return ONLY valid JSON — no markdown, no preamble."""

    user = f"""Extract a complete BRD from these {len(relevant)} sources.
PRIMARY sources are meeting transcripts — extract from these first.

Return this JSON (no other text):
{{
  "executive_summary": "2-4 sentences from source content only",
  "business_objectives": [
    {{"id":"BO-1","description":"...","priority":"high|medium|low","source_quote":"EXACT quote","source_doc":"transcript|email|slack|document"}}
  ],
  "stakeholder_analysis": [
    {{"id":"SH-1","name":"Name from sources","role":"...","interest":"...","influence":"high|medium|low"}}
  ],
  "functional_requirements": [
    {{"id":"FR-1","title":"...","description":"...","priority":"high|medium|low","source_quote":"EXACT quote","source_doc":"..."}}
  ],
  "non_functional_requirements": [
    {{"id":"NFR-1","title":"...","description":"...","category":"security|performance|usability|reliability|scalability|compliance","priority":"medium","source_quote":"EXACT quote","source_doc":"..."}}
  ],
  "assumptions": [
    {{"id":"AS-1","description":"...","risk":"..."}}
  ],
  "success_metrics": [
    {{"id":"SM-1","metric":"...","target":"...","measurement":"..."}}
  ],
  "timeline": {{
    "phases": [{{"name":"...","duration":"...","deliverables":["..."]}}]
  }}
}}

SOURCES (transcripts first — PRIMARY):
{combined[:50000]}"""

    logger.info(f"Extracting BRD from {len(relevant)} sources ({len(combined)} chars)")

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=8192,
        messages=[{"role": "user", "content": f"<s>{system}</s>\n\n{user}"}],
    )

    raw = _strip_fences(message.content[0].text.strip())

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"JSON parse error: {e}\nRaw: {raw[:500]}")
        return _empty_brd()

    # Mentor #2: validate every citation against actual source text
    result = validate_citations(result, relevant)
    return result


def validate_citations(brd: dict, sources: list[dict]) -> dict:
    """
    Anti-hallucination guard.
    Checks every source_quote actually exists in the source corpus.
    Flags unverified quotes so the UI can show a review warning.
    """
    all_text = " ".join(str(s.get("content", "")).lower() for s in sources)

    sections = ["business_objectives", "functional_requirements", "non_functional_requirements"]
    unverified = 0

    for section in sections:
        for item in brd.get(section, []):
            quote = item.get("source_quote", "")
            if not quote or quote.startswith("["):
                item["citation_verified"] = False
                continue

            words = set(re.findall(r"\b\w{4,}\b", quote.lower()))
            if not words:
                item["citation_verified"] = False
                continue

            matched = sum(1 for w in words if w in all_text)
            ratio   = matched / len(words)

            if ratio >= 0.60:
                item["citation_verified"] = True
            else:
                item["citation_verified"] = False
                item["source_quote"] = "[Citation not verified — review required]"
                unverified += 1
                logger.warning(
                    f"Unverified citation {section}/{item.get('id','?')}: "
                    f"'{quote[:60]}' ({ratio:.0%} match)"
                )

    brd["_has_unverified_citations"] = unverified > 0
    brd["_unverified_count"]         = unverified
    if unverified:
        logger.warning(f"⚠  {unverified} unverified citations — flagged for review")
    return brd


def _empty_brd() -> dict:
    return {
        "executive_summary": "Extraction failed — please retry.",
        "business_objectives": [], "stakeholder_analysis": [],
        "functional_requirements": [], "non_functional_requirements": [],
        "assumptions": [], "success_metrics": [],
        "timeline": {"phases": []},
        "_has_unverified_citations": False, "_unverified_count": 0,
    }


def _strip_fences(text: str) -> str:
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$",          "", text, flags=re.MULTILINE)
    return text.strip()