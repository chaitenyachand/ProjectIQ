"""
api/routes/agent.py
Agentic AI endpoints for BRD generation and NL editing.

Endpoints:
  POST /api/agent/generate-brd     — kick off async BRD agent
  GET  /api/agent/status/{run_id}  — poll run status
  POST /api/agent/nl-edit          — natural language BRD editing
  POST /api/agent/rewrite-text     — inline text rewriting
"""

import json
import logging
import os
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from supabase import create_client

import anthropic

logger = logging.getLogger(__name__)
router = APIRouter()

_ANTHROPIC_CLIENT = anthropic.Anthropic()


def _sb():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


# ── Request models ─────────────────────────────────────────────────────────────

class GenerateBRDRequest(BaseModel):
    brd_id: str
    project_id: str
    sources: list[dict]
    project_context: str = ""


class NLEditRequest(BaseModel):
    brd_id: str
    instruction: str
    section: str = ""   # empty = full document


class RewriteRequest(BaseModel):
    text: str
    instruction: str


# ── Generate BRD (async) ───────────────────────────────────────────────────────

@router.post("/generate-brd")
async def generate_brd(req: GenerateBRDRequest, background_tasks: BackgroundTasks):
    """
    Kick off the BRD generation agent as a background task.
    Returns immediately with run_id. Frontend polls /status/{run_id}.
    """
    sb = _sb()

    run = sb.table("agent_runs").insert({
        "brd_id":     req.brd_id,
        "project_id": req.project_id,
        "status":     "running",
        "input":      json.dumps({"source_count": len(req.sources)}),
    }).execute()

    run_id = run.data[0]["id"]

    async def _run():
        from agents.brd_agent import run_brd_agent
        try:
            result = await run_brd_agent(
                brd_id=req.brd_id,
                sources=req.sources,
                project_context=req.project_context,
                run_id=run_id,
                sb=sb,
            )
            status = "done" if result.get("success") else "failed"
        except Exception as e:
            logger.error(f"BRD agent error: {e}")
            result = {"success": False, "error": str(e)}
            status = "failed"

        sb.table("agent_runs").update({
            "status":      status,
            "output":      json.dumps(result),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", run_id).execute()

    background_tasks.add_task(_run)
    return {"run_id": run_id, "status": "running", "brd_id": req.brd_id}


@router.get("/status/{run_id}")
async def agent_status(run_id: str):
    """Poll agent run status. Used by BRDWorkspace.tsx."""
    sb = _sb()
    try:
        result = sb.table("agent_runs").select("*").eq("id", run_id).single().execute()
        return result.data
    except Exception as e:
        raise HTTPException(404, f"Run not found: {run_id}")


# ── Natural Language Editing ───────────────────────────────────────────────────

@router.post("/nl-edit")
async def nl_edit(req: NLEditRequest):
    """
    Apply a natural language instruction to a BRD section.
    Replaces / supplements the Supabase edit-brd-nl edge function.
    """
    sb = _sb()

    # Fetch current BRD
    try:
        brd_result = sb.table("brds").select("*").eq("id", req.brd_id).single().execute()
        brd = brd_result.data
    except Exception:
        raise HTTPException(404, f"BRD not found: {req.brd_id}")

    # Select the section to edit
    section_map = {
        "executive_summary":          brd.get("executive_summary"),
        "business_objectives":        brd.get("business_objectives"),
        "stakeholder_analysis":       brd.get("stakeholder_analysis"),
        "functional_requirements":    brd.get("functional_requirements"),
        "non_functional_requirements":brd.get("non_functional_requirements"),
        "assumptions":                brd.get("assumptions"),
        "success_metrics":            brd.get("success_metrics"),
        "timeline":                   brd.get("timeline"),
    }

    if req.section and req.section in section_map:
        current = {req.section: section_map[req.section]}
    else:
        current = section_map

    # Call Claude
    message = _ANTHROPIC_CLIENT.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": f"""You are editing a Business Requirements Document.

Current content:
{json.dumps(current, indent=2)}

Instruction: {req.instruction}

Apply the instruction and return the modified content in the exact same JSON structure.
Return ONLY valid JSON, no markdown, no explanation.""",
        }],
    )

    raw = message.content[0].text.strip()
    import re
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)

    try:
        modified = json.loads(raw.strip())
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"Claude returned invalid JSON: {e}")

    # Save version history
    try:
        sb.table("brd_versions").insert({
            "brd_id":    req.brd_id,
            "version":   brd.get("version", 1),
            "content":   section_map,
            "edited_by": brd.get("created_by"),
            "edit_note": f"NL Edit: {req.instruction[:100]}",
        }).execute()
    except Exception as e:
        logger.warning(f"Could not save brd_version: {e}")

    # Update BRD
    update_payload = {
        **modified,
        "version":    (brd.get("version") or 1) + 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    sb.table("brds").update(update_payload).eq("id", req.brd_id).execute()

    return {
        "success":    True,
        "brd_id":     req.brd_id,
        "new_version": update_payload["version"],
        "section":    req.section or "full",
        "data":       modified,
    }


# ── Text rewriting helper ──────────────────────────────────────────────────────

@router.post("/rewrite-text")
async def rewrite_text(req: RewriteRequest):
    """
    Generic text rewriting. Called by NaturalLanguageEditor.tsx indirectly
    via the rewrite-brd Supabase edge function.
    """
    message = _ANTHROPIC_CLIENT.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        messages=[{
            "role": "user",
            "content": f"""Rewrite the following text according to the instruction.
Return ONLY the rewritten text, no explanation.

Original text:
{req.text}

Instruction: {req.instruction}""",
        }],
    )
    return {"result": message.content[0].text.strip()}
