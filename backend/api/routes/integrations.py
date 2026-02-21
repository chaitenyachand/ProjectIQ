"""
api/routes/integrations.py — fixed Slack /auth to return 200 with instructions
instead of 500 when OAuth creds not configured.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


def _gmail():
    from integrations.gmail import GmailIntegration
    return GmailIntegration()

def _slack():
    from integrations.slack import SlackIntegration
    return SlackIntegration()

def _fireflies():
    from integrations.fireflies import FirefliesIntegration
    return FirefliesIntegration()


# ── Gmail ─────────────────────────────────────────────────────────────────────

@router.get("/gmail/auth")
async def gmail_auth(user_id: str = Query(...)):
    try:
        url = _gmail().get_auth_url(state=user_id)
        return {"auth_url": url}
    except Exception as e:
        raise HTTPException(500, f"Gmail auth error: {e}")


@router.get("/gmail/callback")
async def gmail_callback(code: str, state: str):
    try:
        g = _gmail()
        tokens = g.exchange_code(code)
        g.save_tokens(user_id=state, tokens=tokens)
        frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:8080")
        return RedirectResponse(f"{frontend_url}/dashboard?integration=gmail&status=connected")
    except Exception as e:
        logger.error(f"Gmail callback error: {e}")
        raise HTTPException(500, f"Gmail callback failed: {e}")


class FetchRequest(BaseModel):
    user_id: str
    max_results: int = 20
    query: str = ""


@router.post("/gmail/fetch")
async def gmail_fetch(req: FetchRequest):
    try:
        g = _gmail()
        creds    = g.load_tokens(req.user_id)
        messages = g.fetch_recent_messages(creds, max_results=req.max_results, query=req.query)
        return {"messages": messages, "count": len(messages), "provider": "gmail"}
    except Exception as e:
        logger.error(f"Gmail fetch error: {e}")
        raise HTTPException(500, f"Gmail fetch failed: {e}")


# ── Slack ─────────────────────────────────────────────────────────────────────

@router.get("/slack/auth")
async def slack_auth(user_id: str = Query(...)):
    """
    Returns auth_url if OAuth is configured, otherwise returns use_bot_token=true
    so the frontend knows to show the bot token dialog instead of redirecting.
    """
    client_id = os.environ.get("SLACK_CLIENT_ID", "")
    if not client_id:
        # Tell frontend to use bot token flow — don't 500
        return {"auth_url": None, "use_bot_token": True,
                "message": "Slack OAuth not configured — use bot token for local dev"}
    try:
        url = _slack().get_auth_url(state=user_id)
        return {"auth_url": url, "use_bot_token": False}
    except Exception as e:
        raise HTTPException(500, f"Slack auth error: {e}")


@router.get("/slack/callback")
async def slack_callback(code: str, state: str):
    try:
        s = _slack()
        tokens = s.exchange_code(code)
        s.save_tokens(user_id=state, tokens=tokens)
        frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:8080")
        return RedirectResponse(f"{frontend_url}/dashboard?integration=slack&status=connected")
    except Exception as e:
        logger.error(f"Slack callback error: {e}")
        raise HTTPException(500, f"Slack callback failed: {e}")


class SlackBotConnectRequest(BaseModel):
    user_id: str
    bot_token: str
    workspace: str = "local"


@router.post("/slack/connect-bot")
async def slack_connect_bot(req: SlackBotConnectRequest):
    """Local dev: bypass OAuth using a bot token directly."""
    try:
        s = _slack()
        s.save_bot_token(req.user_id, req.bot_token, req.workspace)
        channels = s.list_channels(req.bot_token)
        return {
            "success": True, "workspace": req.workspace,
            "channels_found": len(channels),
            "message": "Bot token saved. Slack connected.",
        }
    except Exception as e:
        raise HTTPException(500, f"Slack bot connect failed: {e}")


class SlackFetchRequest(BaseModel):
    user_id: str
    channel: str = ""
    limit: int = 50


@router.post("/slack/fetch")
async def slack_fetch(req: SlackFetchRequest):
    try:
        s        = _slack()
        token    = s.load_tokens(req.user_id)
        messages = s.fetch_messages(token, channel=req.channel or None, limit=req.limit)
        return {"messages": messages, "count": len(messages), "provider": "slack"}
    except Exception as e:
        logger.error(f"Slack fetch error: {e}")
        raise HTTPException(500, f"Slack fetch failed: {e}")


@router.get("/slack/channels")
async def slack_channels(user_id: str = Query(...)):
    try:
        s        = _slack()
        token    = s.load_tokens(user_id)
        channels = s.list_channels(token)
        return {"channels": channels}
    except Exception as e:
        raise HTTPException(500, f"Slack channels error: {e}")


# ── Fireflies ─────────────────────────────────────────────────────────────────

class FirefliesValidateRequest(BaseModel):
    api_key: str


@router.post("/fireflies/validate-key")
async def fireflies_validate_key(req: FirefliesValidateRequest):
    ff = _fireflies()
    valid, error = ff.validate_key(req.api_key)
    return {"valid": valid, "message": "" if valid else error}


class FirefliesConnectRequest(BaseModel):
    user_id: str
    api_key: str


@router.post("/fireflies/connect")
async def fireflies_connect(req: FirefliesConnectRequest):
    ff = _fireflies()
    valid, error = ff.validate_key(req.api_key)
    if not valid:
        raise HTTPException(400, f"Invalid API key: {error}")
    ff.save_api_key(req.user_id, req.api_key)
    return {"success": True, "message": "Fireflies API key saved"}


class FirefliesFetchRequest(BaseModel):
    user_id: str
    limit: int = 10


@router.post("/fireflies/fetch")
async def fireflies_fetch(req: FirefliesFetchRequest):
    try:
        ff = _fireflies()
        transcripts = ff.fetch_transcripts(user_id=req.user_id, limit=req.limit)
        return {"transcripts": transcripts, "count": len(transcripts), "provider": "fireflies"}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.error(f"Fireflies fetch error: {e}")
        raise HTTPException(500, f"Fireflies fetch failed: {e}")


# ── Status ─────────────────────────────────────────────────────────────────────

@router.get("/status/{user_id}")
async def integration_status(user_id: str):
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    try:
        result = sb.table("integration_accounts").select(
            "provider, is_active, account_email, metadata, updated_at"
        ).eq("user_id", user_id).execute()
        statuses = {row["provider"]: row for row in result.data}
        if os.environ.get("SLACK_BOT_TOKEN"):
            statuses["slack"] = {"is_active": True, "account_email": "bot-token", "provider": "slack", "metadata": {"workspace_name": "local"}}
        return {
            "gmail":     statuses.get("gmail",     {"is_active": False}),
            "slack":     statuses.get("slack",     {"is_active": False}),
            "fireflies": statuses.get("fireflies", {"is_active": False}),
        }
    except Exception:
        return {"gmail": {"is_active": False}, "slack": {"is_active": False}, "fireflies": {"is_active": False}}
    
@router.get("/gmail/labels")
async def gmail_labels(user_id: str):
    """Return all Gmail labels for the connected account."""
    from integrations.gmail import load_gmail_client
    client = load_gmail_client(user_id)
    labels = client.list_labels()   # calls Gmail labels.list API
    return {"labels": labels}