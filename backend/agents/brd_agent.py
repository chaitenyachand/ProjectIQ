"""
agents/brd_agent.py
The core agentic AI for BRD generation.

Architecture:
  - Orchestrates multiple specialized tools in a reasoning loop
  - Uses Claude claude-sonnet-4-20250514 via direct Anthropic API (tool_use feature)
  - Each step is logged to agent_steps in Supabase for explainability
  - Runs as a FastAPI BackgroundTask so the frontend gets immediate run_id feedback

Tool calling sequence (agent decides order based on context):
  1. filter_noise       — ML relevance classification
  2. extract_brd        — structured BRD extraction via Claude
  3. detect_conflicts   — conflict detection on extracted requirements
  4. analyze_sentiment  — stakeholder sentiment
  5. save_brd           — persist to Supabase
"""

import json
import logging
import os
from datetime import datetime, timezone

import anthropic
import httpx
from supabase import create_client

from agents.tools.extract_tool import extract_requirements
from agents.tools.conflict_tool import detect_conflicts_in_requirements
from agents.tools.sentiment_tool import analyze_stakeholder_sentiment

logger = logging.getLogger(__name__)

_ANTHROPIC_CLIENT = anthropic.Anthropic()


# ── Tool schemas (Anthropic tool_use format) ───────────────────────────────────

TOOLS = [
    {
        "name": "filter_noise",
        "description": (
            "Filter irrelevant/noisy content from input sources using the ML relevance classifier. "
            "Call this FIRST before any other tool. "
            "Input: list of source dicts. Output: filtered sources with relevance scores."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sources": {
                    "type": "array",
                    "description": "List of source dicts with type, content, metadata fields",
                }
            },
            "required": ["sources"],
        },
    },
    {
        "name": "extract_brd",
        "description": (
            "Extract structured BRD content (functional requirements, non-functional requirements, "
            "business objectives, stakeholders, assumptions, success metrics, timeline) "
            "from the filtered sources."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sources": {
                    "type": "array",
                    "description": "Filtered source dicts from filter_noise output",
                }
            },
            "required": ["sources"],
        },
    },
    {
        "name": "detect_conflicts",
        "description": (
            "Identify conflicting or contradictory requirements in the extracted BRD. "
            "Call this after extract_brd when there are 5+ requirements."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "requirements": {
                    "type": "object",
                    "description": "Dict with functional_requirements, non_functional_requirements, business_objectives arrays",
                }
            },
            "required": ["requirements"],
        },
    },
    {
        "name": "analyze_sentiment",
        "description": (
            "Analyze stakeholder sentiment from the source communications. "
            "Call this after extract_brd to understand stakeholder concerns."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sources": {
                    "type": "array",
                    "description": "Original or filtered source dicts",
                }
            },
            "required": ["sources"],
        },
    },
    {
        "name": "save_brd",
        "description": (
            "Persist the completed BRD to the database. Call this LAST after all other tools. "
            "Pass the complete BRD content including any conflicts and sentiment data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "brd_id":      {"type": "string"},
                "brd_content": {"type": "object"},
                "conflicts":   {"type": "array"},
                "sentiment":   {"type": "object"},
            },
            "required": ["brd_id", "brd_content"],
        },
    },
]


# ── Tool execution ─────────────────────────────────────────────────────────────

def _execute_tool(name: str, inputs: dict, brd_id: str, run_id: str, sb) -> dict:
    """Execute a tool and log the step to Supabase."""
    logger.info(f"  🔧 Tool: {name}")

    try:
        if name == "filter_noise":
            result = _tool_filter_noise(inputs)
        elif name == "extract_brd":
            result = _tool_extract_brd(inputs)
        elif name == "detect_conflicts":
            result = _tool_detect_conflicts(inputs)
        elif name == "analyze_sentiment":
            result = _tool_analyze_sentiment(inputs)
        elif name == "save_brd":
            result = _tool_save_brd(inputs, brd_id, sb)
        else:
            result = {"error": f"Unknown tool: {name}"}
    except Exception as e:
        logger.error(f"Tool {name} failed: {e}")
        result = {"error": str(e)}

    # Log to agent_steps
    try:
        sb.table("agent_steps").insert({
            "run_id":     run_id,
            "tool_name":  name,
            "tool_input": inputs,
            "tool_output": result,
        }).execute()
    except Exception as log_err:
        logger.warning(f"Could not log agent step: {log_err}")

    return result


def _tool_filter_noise(inputs: dict) -> dict:
    sources = inputs.get("sources", [])
    if not sources:
        return {"filtered_sources": [], "noise_removed": 0}

    # Call our own ML endpoint
    try:
        resp = httpx.post(
            "http://localhost:8000/api/ml/filter-sources",
            json={"sources": sources, "threshold": 0.3},
            timeout=30,
        )
        data = resp.json()
        return data
    except Exception as e:
        # Fallback: pass all sources through
        logger.warning(f"ML filter unavailable ({e}), passing all sources")
        return {
            "filtered_sources": [
                {**s, "relevance_score": 1.0, "is_relevant": True}
                for s in sources
            ],
            "noise_removed": 0,
        }


def _tool_extract_brd(inputs: dict) -> dict:
    sources = inputs.get("sources", [])
    result = extract_requirements(sources)
    return {"brd_content": result}


def _tool_detect_conflicts(inputs: dict) -> dict:
    reqs = inputs.get("requirements", {})
    conflicts = detect_conflicts_in_requirements(reqs)
    return {"conflicts": conflicts, "count": len(conflicts)}


def _tool_analyze_sentiment(inputs: dict) -> dict:
    sources = inputs.get("sources", [])
    sentiment = analyze_stakeholder_sentiment(sources)
    return {"sentiment": sentiment}


def _tool_save_brd(inputs: dict, brd_id: str, sb) -> dict:
    brd_content = inputs.get("brd_content", {})
    conflicts   = inputs.get("conflicts", [])
    sentiment   = inputs.get("sentiment", {})

    update_payload = {
        **brd_content,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        sb.table("brds").update(update_payload).eq("id", brd_id).execute()

        # Store conflicts + sentiment in raw_sources metadata for the UI panels
        # (ConflictDetectionPanel and SentimentAnalysisPanel read from edge functions,
        #  which can now return these pre-computed results)
        if conflicts or sentiment:
            extra = {}
            if conflicts:
                extra["_conflicts"] = conflicts
            if sentiment:
                extra["_sentiment"] = sentiment

            # Append metadata to raw_sources so the frontend panels can access it
            existing = sb.table("brds").select("raw_sources").eq("id", brd_id).single().execute()
            current_sources = existing.data.get("raw_sources") or []
            if isinstance(current_sources, list):
                current_sources.append({"type": "_agent_metadata", **extra})
            sb.table("brds").update({"raw_sources": current_sources}).eq("id", brd_id).execute()

        return {"success": True, "brd_id": brd_id}
    except Exception as e:
        logger.error(f"save_brd failed: {e}")
        return {"success": False, "error": str(e)}


# ── Agent loop ─────────────────────────────────────────────────────────────────

async def run_brd_agent(
    brd_id: str,
    sources: list[dict],
    project_context: str,
    run_id: str,
    sb,
) -> dict:
    """
    Main agentic loop using Anthropic's tool_use API.
    The agent autonomously decides which tools to call and in what order.
    """
    messages = [
        {
            "role": "user",
            "content": f"""You are generating a Business Requirements Document for BRD ID: {brd_id}.

Project context: {project_context or "Not provided"}
Number of input sources: {len(sources)}

Your job:
1. Call filter_noise to remove irrelevant content from the {len(sources)} sources
2. Call extract_brd on the filtered sources to get structured BRD content
3. Call detect_conflicts if there are 5+ requirements
4. Call analyze_sentiment to understand stakeholder views
5. Call save_brd with the complete results

Be thorough. Extract as many requirements as the sources support.
Start now by calling filter_noise.""",
        }
    ]

    # Pass source previews (first 500 chars each to stay within context)
    source_previews = [
        {
            "type":     s.get("type", "text"),
            "content":  str(s.get("content", ""))[:500],
            "metadata": s.get("metadata", {}),
        }
        for s in sources
    ]
    # Inject full sources for tools to access via context
    _source_store = {run_id: sources}

    state = {
        "filtered_sources": None,
        "brd_content":      None,
        "conflicts":        [],
        "sentiment":        {},
        "done":             False,
    }

    max_steps = 10
    for step in range(max_steps):
        logger.info(f"Agent step {step + 1}/{max_steps}")

        response = _ANTHROPIC_CLIENT.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            tools=TOOLS,
            messages=messages,
        )

        # Append assistant response
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            logger.info("Agent completed (end_turn)")
            state["done"] = True
            break

        if response.stop_reason != "tool_use":
            logger.warning(f"Unexpected stop_reason: {response.stop_reason}")
            break

        # Process all tool calls in this response
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            tool_name = block.name
            tool_input = block.input

            # For filter_noise, inject the full sources
            if tool_name == "filter_noise" and not tool_input.get("sources"):
                tool_input["sources"] = sources
            elif tool_name == "extract_brd" and not tool_input.get("sources"):
                tool_input["sources"] = state.get("filtered_sources") or sources
            elif tool_name == "analyze_sentiment" and not tool_input.get("sources"):
                tool_input["sources"] = state.get("filtered_sources") or sources

            result = _execute_tool(tool_name, tool_input, brd_id, run_id, sb)

            # Update state
            if tool_name == "filter_noise":
                state["filtered_sources"] = result.get("filtered_sources", sources)
            elif tool_name == "extract_brd":
                state["brd_content"] = result.get("brd_content")
            elif tool_name == "detect_conflicts":
                state["conflicts"] = result.get("conflicts", [])
            elif tool_name == "analyze_sentiment":
                state["sentiment"] = result.get("sentiment", {})
            elif tool_name == "save_brd":
                if result.get("success"):
                    state["done"] = True

            tool_results.append({
                "type":        "tool_result",
                "tool_use_id": block.id,
                "content":     json.dumps(result),
            })

        messages.append({"role": "user", "content": tool_results})

        if state["done"]:
            break

    # Ensure BRD is saved even if agent didn't call save_brd
    if state["brd_content"] and not state["done"]:
        logger.warning("Agent ended without calling save_brd — saving manually")
        _tool_save_brd({
            "brd_id":      brd_id,
            "brd_content": state["brd_content"],
            "conflicts":   state["conflicts"],
            "sentiment":   state["sentiment"],
        }, brd_id, sb)

    return {
        "success":      bool(state["brd_content"]),
        "brd_id":       brd_id,
        "steps":        len(messages),
        "conflicts":    len(state["conflicts"]),
        "has_sentiment": bool(state["sentiment"]),
    }
