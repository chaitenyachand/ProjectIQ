"""
agents/tools/conflict_tool.py
Detects conflicting requirements using heuristic candidate selection
followed by Claude claude-sonnet-4-20250514 conflict classification.

Algorithm:
  1. Build candidate pairs via keyword overlap heuristic (fast, no embedding model needed)
  2. Send top-N candidate pairs to Claude for classification
  3. Return only confirmed conflicts with explanations and recommendations
"""

import json
import logging
import re
from itertools import combinations

import anthropic

logger = logging.getLogger(__name__)
client = anthropic.Anthropic()

# Keywords that signal potential opposition / conflict
_NEGATION_RE = re.compile(
    r"\b(no\b|not\b|never\b|cannot\b|must not|shall not|prevent|restrict|limit|"
    r"disallow|forbid|prohibit|exclude|block|deny)\b",
    re.IGNORECASE,
)

# Resource/capacity words that often conflict
_RESOURCE_RE = re.compile(
    r"\b(budget|cost|bandwidth|capacity|memory|storage|cpu|staff|team|resource|"
    r"time|hours|deadline|schedule|timeline|concurrent|simultaneous)\b",
    re.IGNORECASE,
)


def _word_overlap(a: str, b: str) -> float:
    """Jaccard similarity of word sets."""
    wa = set(re.findall(r"\b\w{4,}\b", a.lower()))
    wb = set(re.findall(r"\b\w{4,}\b", b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _is_candidate_pair(r1: dict, r2: dict) -> bool:
    """Quick heuristic: should this pair be sent to Claude?"""
    t1 = (r1.get("description") or r1.get("title") or "").lower()
    t2 = (r2.get("description") or r2.get("title") or "").lower()

    # High overlap AND negation in either → likely conflict
    if _word_overlap(t1, t2) > 0.30 and (
        _NEGATION_RE.search(t1) or _NEGATION_RE.search(t2)
    ):
        return True

    # Both reference same resource keywords → possible conflict
    r1_resources = set(_RESOURCE_RE.findall(t1))
    r2_resources = set(_RESOURCE_RE.findall(t2))
    if r1_resources & r2_resources and r1.get("type") != r2.get("type"):
        return True

    return False


def detect_conflicts_in_requirements(reqs: dict) -> list[dict]:
    """
    reqs: dict with keys functional_requirements, non_functional_requirements,
          business_objectives (arrays of requirement dicts).

    Returns: list of conflict dicts:
        {id, type, severity, requirement1_id, requirement2_id, description, recommendation}
    """
    all_reqs = [
        {**r, "_rtype": "functional"}
        for r in reqs.get("functional_requirements", [])
    ] + [
        {**r, "_rtype": "non_functional"}
        for r in reqs.get("non_functional_requirements", [])
    ] + [
        {**r, "_rtype": "objective"}
        for r in reqs.get("business_objectives", [])
    ]

    if len(all_reqs) < 2:
        return []

    # Find candidate pairs (limit to 20 for Claude token budget)
    candidates = [
        (r1, r2)
        for r1, r2 in combinations(all_reqs, 2)
        if _is_candidate_pair(r1, r2)
    ][:20]

    if not candidates:
        logger.info("No candidate conflict pairs found via heuristic.")
        return []

    logger.info(f"Sending {len(candidates)} candidate pairs to Claude for conflict analysis")

    pairs_text = "\n\n".join([
        f"Pair {i+1}:\n"
        f"  {p[0].get('id','?')} ({p[0].get('_rtype','')}): {p[0].get('description') or p[0].get('title','')}\n"
        f"  {p[1].get('id','?')} ({p[1].get('_rtype','')}): {p[1].get('description') or p[1].get('title','')}"
        for i, p in enumerate(candidates)
    ])

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": f"""Analyze these requirement pairs for genuine conflicts.

A conflict exists when requirements contradict each other, compete for limited resources,
have incompatible timelines, overlap in scope creating ambiguity, or have misaligned priorities.

Return a JSON array (return [] if no real conflicts):
[{{
  "id": "C-1",
  "type": "direct|resource|timeline|scope|priority",
  "severity": "high|medium|low",
  "requirement1_id": "FR-1",
  "requirement2_id": "NFR-2",
  "description": "Clear explanation of the conflict",
  "recommendation": "Specific resolution suggestion"
}}]

Return ONLY the JSON array. No preamble.

REQUIREMENT PAIRS:
{pairs_text}""",
        }],
    )

    raw = message.content[0].text.strip()
    # Strip any accidental markdown
    if "```" in raw:
        raw = raw.split("```")[1] if "```json" not in raw else raw.split("```json")[1].split("```")[0]

    try:
        conflicts = json.loads(raw)
        if not isinstance(conflicts, list):
            conflicts = []
    except json.JSONDecodeError as e:
        logger.warning(f"Conflict parse error: {e}")
        conflicts = []

    logger.info(f"Found {len(conflicts)} conflicts")
    return conflicts
