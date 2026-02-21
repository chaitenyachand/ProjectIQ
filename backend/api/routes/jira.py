"""
api/routes/jira.py
Jira integration endpoints.

Endpoints:
  POST /api/integrations/jira/connect      — save credentials
  GET  /api/integrations/jira/projects     — list Jira projects
  POST /api/integrations/jira/sync         — push tasks to Jira
  GET  /api/integrations/jira/status       — connection status
"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/jira", tags=["Jira"])


class JiraConnectRequest(BaseModel):
    user_id:   str
    base_url:  str   # e.g. https://yourcompany.atlassian.net
    email:     str
    api_token: str


class JiraSyncRequest(BaseModel):
    user_id:     str
    task_ids:    list[str]
    project_key: str          # Jira project key e.g. "PROJ"
    brd_title:   str = ""


@router.post("/connect")
async def jira_connect(req: JiraConnectRequest):
    """
    Save Jira credentials and verify they work.
    Called when user fills in the Jira connection form in IntegrationCard.
    """
    from integrations.jira import JiraIntegration, save_jira_config

    # Test credentials before saving
    try:
        client = JiraIntegration(req.base_url, req.email, req.api_token)
        user_info = client.test_connection()
    except Exception as e:
        raise HTTPException(400, f"Jira connection failed — check your credentials: {e}")

    save_jira_config(
        user_id   = req.user_id,
        base_url  = req.base_url,
        email     = req.email,
        api_token = req.api_token,
    )

    return {
        "success":      True,
        "jira_user":    user_info.get("displayName", ""),
        "jira_account": user_info.get("emailAddress", ""),
    }


@router.get("/projects")
async def jira_projects(user_id: str):
    """List Jira projects available to the connected account."""
    from integrations.jira import load_jira_client
    try:
        client = load_jira_client(user_id)
        projects = client.get_projects()
        return {"projects": projects}
    except Exception as e:
        raise HTTPException(500, f"Could not fetch Jira projects: {e}")


@router.post("/sync")
async def jira_sync(req: JiraSyncRequest):
    """
    Push a list of tasks to Jira as Story issues.
    Writes jira_issue_key + jira_issue_url back to Supabase tasks table.
    """
    from integrations.jira import sync_tasks_to_jira
    result = await sync_tasks_to_jira(
        user_id     = req.user_id,
        task_ids    = req.task_ids,
        project_key = req.project_key,
        brd_title   = req.brd_title,
    )
    if not result["success"] and result.get("error"):
        raise HTTPException(500, result["error"])
    return result


@router.get("/status")
async def jira_status(user_id: str):
    """Check if Jira is connected for this user."""
    import os
    from supabase import create_client
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    try:
        row = (
            sb.table("integration_accounts")
            .select("is_active, account_email, metadata, updated_at")
            .eq("user_id", user_id)
            .eq("provider", "jira")
            .single()
            .execute()
        )
        data = row.data
        return {
            "connected":     data["is_active"],
            "account_email": data.get("account_email"),
            "base_url":      (data.get("metadata") or {}).get("base_url"),
            "updated_at":    data.get("updated_at"),
        }
    except Exception:
        return {"connected": False}
