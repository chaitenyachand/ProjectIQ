"""
integrations/fireflies.py — fixed to read FIREFLIES_API_KEY from env properly
and handle empty transcript lists gracefully.
"""

import logging
import os
import httpx
from supabase import create_client

logger = logging.getLogger(__name__)
FIREFLIES_API_URL = "https://api.fireflies.ai/graphql"


class FirefliesIntegration:
    def _sb(self):
        return create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )

    def _get_api_key(self, user_id: str) -> str:
        """Priority: .env FIREFLIES_API_KEY → Supabase stored key."""
        key = os.environ.get("FIREFLIES_API_KEY", "").strip()
        if key:
            return key
        try:
            sb  = self._sb()
            row = (
                sb.table("integration_accounts")
                .select("access_token")
                .eq("user_id", user_id)
                .eq("provider", "fireflies")
                .single()
                .execute()
            )
            return row.data.get("access_token", "").strip()
        except Exception:
            return ""

    def save_api_key(self, user_id: str, api_key: str):
        sb = self._sb()
        sb.table("integration_accounts").upsert({
            "user_id":      user_id,
            "provider":     "fireflies",
            "access_token": api_key,
            "is_active":    True,
        }, on_conflict="user_id,provider").execute()

    def validate_key(self, api_key: str) -> tuple[bool, str]:
        """Returns (valid, error_message)."""
        try:
            resp = httpx.post(
                FIREFLIES_API_URL,
                json={"query": "query { user { user_id name email } }"},
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                timeout=10,
            )
            data = resp.json()
            if resp.status_code == 401:
                return False, "Invalid API key (401 Unauthorized)"
            if "errors" in data:
                msg = data["errors"][0].get("message", "Unknown error") if data["errors"] else "Unknown"
                return False, msg
            if data.get("data", {}).get("user"):
                return True, ""
            return False, "API key not recognized"
        except httpx.TimeoutException:
            return False, "Request timed out"
        except Exception as e:
            return False, str(e)

    def fetch_transcripts(self, user_id: str, limit: int = 10) -> list[dict]:
        api_key = self._get_api_key(user_id)

        if not api_key:
            raise ValueError(
                "No Fireflies API key found.\n"
                "Add FIREFLIES_API_KEY=your-key to backend/.env and restart."
            )

        # Try full query with sentences first
        result = self._fetch_full(api_key, limit)
        if result is None:
            result = self._fetch_summary_only(api_key, limit)

        return result or []

    def _graphql(self, api_key: str, query: str, variables: dict) -> dict | None:
        try:
            resp = httpx.post(
                FIREFLIES_API_URL,
                json={"query": query, "variables": variables},
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                timeout=30,
            )
            if resp.status_code == 401:
                raise ValueError("Fireflies API key invalid (401)")
            if resp.status_code != 200:
                raise ValueError(f"Fireflies returned HTTP {resp.status_code}")
            return resp.json()
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.error(f"Fireflies network error: {e}")
            return None

    def _fetch_full(self, api_key: str, limit: int) -> list[dict] | None:
        query = """
        query Transcripts($limit: Int) {
          transcripts(limit: $limit) {
            id title date duration
            summary { keywords action_items overview outline }
            sentences { index speaker_name text start_time }
          }
        }
        """
        data = self._graphql(api_key, query, {"limit": limit})
        if not data:
            return None
        if "errors" in data:
            err = data["errors"][0].get("message", "") if data["errors"] else ""
            if any(w in err.lower() for w in ["sentence", "plan", "permission", "field"]):
                return None  # fall back to summary-only
            raise ValueError(f"Fireflies error: {err}")
        return self._parse(data.get("data", {}).get("transcripts") or [])

    def _fetch_summary_only(self, api_key: str, limit: int) -> list[dict]:
        query = """
        query Transcripts($limit: Int) {
          transcripts(limit: $limit) {
            id title date duration
            summary { keywords action_items overview outline }
          }
        }
        """
        data = self._graphql(api_key, query, {"limit": limit})
        if not data:
            return []
        if "errors" in data:
            err = data["errors"][0].get("message", "") if data["errors"] else "Unknown"
            raise ValueError(f"Fireflies error: {err}")
        return self._parse(data.get("data", {}).get("transcripts") or [])

    def _parse(self, raw: list) -> list[dict]:
        results = []
        for t in raw:
            sentences = t.get("sentences") or []
            full_text = "\n".join([
                f"{s.get('speaker_name', 'Speaker')}: {s.get('text', '')}"
                for s in sentences
            ])
            summary      = t.get("summary") or {}
            action_items = summary.get("action_items") or []
            keywords     = summary.get("keywords") or []
            overview     = summary.get("overview") or ""

            results.append({
                "id":           t.get("id", ""),
                "title":        t.get("title", "Untitled"),
                "date":         t.get("date", ""),
                "duration":     t.get("duration", 0),
                "overview":     overview,
                "outline":      summary.get("outline", ""),
                "action_items": action_items if isinstance(action_items, list) else [],
                "keywords":     keywords if isinstance(keywords, list) else [],
                "type":         "transcript",
                "content":      full_text or overview,
                "metadata":     {
                    "subject":      t.get("title", ""),
                    "date":         t.get("date", ""),
                    "action_items": action_items if isinstance(action_items, list) else [],
                    "keywords":     keywords if isinstance(keywords, list) else [],
                },
            })
        return results