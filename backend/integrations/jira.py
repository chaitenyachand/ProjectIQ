"""
integrations/jira.py
Push generated tasks to Jira as issues.
Stores jira_issue_id back in Supabase tasks table for two-way traceability.

Setup:
  1. User provides their Jira base URL, email, and API token
  2. Stored in integration_accounts table (provider = "jira")
  3. Call sync_tasks_to_jira() after task generation

Jira API docs: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
"""

import logging
import os
from typing import Optional

import httpx
from supabase import create_client

logger = logging.getLogger(__name__)

# Map ProjectIQ priority → Jira priority name
PRIORITY_MAP = {
    "critical": "Highest",
    "high":     "High",
    "medium":   "Medium",
    "low":      "Low",
}

# Map ProjectIQ status → Jira transition name
STATUS_MAP = {
    "backlog":     "To Do",
    "todo":        "To Do",
    "in_progress": "In Progress",
    "in_review":   "In Review",
    "done":        "Done",
    "blocked":     "Blocked",
}


class JiraIntegration:
    def __init__(self, base_url: str, email: str, api_token: str):
        """
        base_url:  e.g. "https://yourcompany.atlassian.net"
        email:     Jira account email
        api_token: from https://id.atlassian.com/manage-profile/security/api-tokens
        """
        self.base_url  = base_url.rstrip("/")
        self.auth      = (email, api_token)
        self.headers   = {
            "Accept":       "application/json",
            "Content-Type": "application/json",
        }

    def _get(self, path: str) -> dict:
        resp = httpx.get(
            f"{self.base_url}/rest/api/3{path}",
            auth=self.auth, headers=self.headers, timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def _post(self, path: str, body: dict) -> dict:
        resp = httpx.post(
            f"{self.base_url}/rest/api/3{path}",
            auth=self.auth, headers=self.headers,
            json=body, timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def test_connection(self) -> dict:
        """Verify credentials work. Returns current user info."""
        return self._get("/myself")

    def get_projects(self) -> list[dict]:
        """List all Jira projects the user has access to."""
        data = self._get("/project/search?maxResults=50")
        return [
            {"id": p["id"], "key": p["key"], "name": p["name"]}
            for p in data.get("values", [])
        ]

    def create_issue(
        self,
        project_key: str,
        title: str,
        description: str,
        priority: str = "medium",
        story_points: Optional[float] = None,
        labels: Optional[list[str]] = None,
        requirement_id: Optional[str] = None,
    ) -> dict:
        """
        Create a single Jira issue (Story type).
        Returns the created issue: {id, key, url}
        """
        # Build Atlassian Document Format description
        adf_description = {
            "type":    "doc",
            "version": 1,
            "content": [
                {
                    "type":    "paragraph",
                    "content": [{"type": "text", "text": description or title}],
                }
            ],
        }

        if requirement_id:
            adf_description["content"].append({
                "type":    "paragraph",
                "content": [
                    {"type": "text", "text": f"Requirement: {requirement_id}", "marks": [{"type": "strong"}]}
                ],
            })

        body = {
            "fields": {
                "project":     {"key": project_key},
                "summary":     title[:255],
                "description": adf_description,
                "issuetype":   {"name": "Story"},
                "priority":    {"name": PRIORITY_MAP.get(priority, "Medium")},
                "labels":      labels or (["projectiq", requirement_id] if requirement_id else ["projectiq"]),
            }
        }

        # Story points — field key varies by Jira config; try common ones
        if story_points is not None:
            estimated_sp = max(1, round(story_points / 8))  # hours → days
            body["fields"]["story_points"] = estimated_sp
            body["fields"]["customfield_10016"] = estimated_sp  # most common SP field

        result = self._post("/issue", body)
        return {
            "id":  result["id"],
            "key": result["key"],
            "url": f"{self.base_url}/browse/{result['key']}",
        }

    def sync_tasks(
        self,
        tasks: list[dict],
        project_key: str,
        brd_title: str = "",
    ) -> list[dict]:
        """
        Sync a list of ProjectIQ tasks to Jira.
        Returns list of {task_id, jira_key, jira_url, success, error}.
        """
        results = []
        for task in tasks:
            try:
                issue = self.create_issue(
                    project_key    = project_key,
                    title          = task.get("title", "Untitled Task"),
                    description    = task.get("description", ""),
                    priority       = task.get("priority", "medium"),
                    story_points   = task.get("estimated_hours"),
                    requirement_id = task.get("requirement_id"),
                    labels         = ["projectiq", brd_title[:50]] if brd_title else ["projectiq"],
                )
                results.append({
                    "task_id":  task["id"],
                    "jira_key": issue["key"],
                    "jira_url": issue["url"],
                    "success":  True,
                    "error":    None,
                })
                logger.info(f"Created Jira issue {issue['key']} for task '{task.get('title')}'")
            except Exception as e:
                logger.error(f"Failed to create Jira issue for task {task.get('id')}: {e}")
                results.append({
                    "task_id":  task.get("id", ""),
                    "jira_key": None,
                    "jira_url": None,
                    "success":  False,
                    "error":    str(e),
                })

        return results


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _sb():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def save_jira_config(user_id: str, base_url: str, email: str, api_token: str):
    """Save Jira credentials to integration_accounts."""
    sb = _sb()
    sb.table("integration_accounts").upsert({
        "user_id":      user_id,
        "provider":     "jira",
        "access_token": api_token,
        "account_email": email,
        "is_active":    True,
        "metadata": {
            "base_url": base_url,
            "email":    email,
        },
    }, on_conflict="user_id,provider").execute()


def load_jira_client(user_id: str) -> JiraIntegration:
    """Load saved Jira credentials and return a client."""
    sb = _sb()
    row = (
        sb.table("integration_accounts")
        .select("*")
        .eq("user_id", user_id)
        .eq("provider", "jira")
        .single()
        .execute()
    )
    data = row.data
    meta = data.get("metadata") or {}
    return JiraIntegration(
        base_url  = meta.get("base_url", ""),
        email     = data.get("account_email", ""),
        api_token = data["access_token"],
    )


async def sync_tasks_to_jira(
    user_id: str,
    task_ids: list[str],
    project_key: str,
    brd_title: str = "",
) -> dict:
    """
    Main entry point called by /api/integrations/jira/sync endpoint.
    Fetches tasks from Supabase, syncs to Jira, writes jira_issue_key back.
    """
    sb = _sb()

    # Fetch tasks
    rows = sb.table("tasks").select("*").in_("id", task_ids).execute()
    tasks = rows.data or []

    if not tasks:
        return {"success": False, "error": "No tasks found", "synced": 0}

    # Load Jira client
    try:
        jira = load_jira_client(user_id)
    except Exception as e:
        return {"success": False, "error": f"Jira not connected: {e}", "synced": 0}

    # Sync
    results = jira.sync_tasks(tasks, project_key=project_key, brd_title=brd_title)

    # Write jira_issue_key back to tasks table
    # (add jira_issue_key TEXT column to tasks table via migration if not present)
    synced = 0
    for r in results:
        if r["success"]:
            try:
                sb.table("tasks").update({
                    "jira_issue_key": r["jira_key"],
                    "jira_issue_url": r["jira_url"],
                }).eq("id", r["task_id"]).execute()
                synced += 1
            except Exception as e:
                logger.warning(f"Could not write jira_issue_key to task {r['task_id']}: {e}")

    failed = len(results) - synced
    return {
        "success": True,
        "synced":  synced,
        "failed":  failed,
        "results": results,
    }
