"""
integrations/slack.py — fixed load_tokens to handle missing row gracefully,
and expose the token via env var path reliably.
"""

import logging
import os

from slack_sdk import WebClient
from slack_sdk.oauth import AuthorizeUrlGenerator
from supabase import create_client

logger = logging.getLogger(__name__)
SCOPES = ["channels:history", "channels:read", "users:read"]


class SlackIntegration:
    def __init__(self):
        self.client_id     = os.environ.get("SLACK_CLIENT_ID", "")
        self.client_secret = os.environ.get("SLACK_CLIENT_SECRET", "")
        self.redirect_uri  = os.environ.get("SLACK_REDIRECT_URI", "")
        self.bot_token     = os.environ.get("SLACK_BOT_TOKEN", "")

    def _sb(self):
        return create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )

    def get_auth_url(self, state: str) -> str:
        if not self.client_id:
            raise ValueError("SLACK_CLIENT_ID not set")
        gen = AuthorizeUrlGenerator(
            client_id=self.client_id,
            scopes=SCOPES,
            redirect_uri=self.redirect_uri,
        )
        return gen.generate(state=state)

    def exchange_code(self, code: str) -> dict:
        client = WebClient()
        resp = client.oauth_v2_access(
            client_id=self.client_id,
            client_secret=self.client_secret,
            code=code,
            redirect_uri=self.redirect_uri,
        )
        return {
            "access_token":   resp["access_token"],
            "workspace_name": resp.get("team", {}).get("name", ""),
            "workspace_id":   resp.get("team", {}).get("id", ""),
        }

    def save_tokens(self, user_id: str, tokens: dict):
        sb = self._sb()
        sb.table("integration_accounts").upsert({
            "user_id":      user_id,
            "provider":     "slack",
            "access_token": tokens["access_token"],
            "is_active":    True,
            "metadata":     {
                "workspace_name": tokens.get("workspace_name", ""),
                "workspace_id":   tokens.get("workspace_id", ""),
            },
        }, on_conflict="user_id,provider").execute()

    def save_bot_token(self, user_id: str, token: str, workspace: str = "local"):
        sb = self._sb()
        sb.table("integration_accounts").upsert({
            "user_id":      user_id,
            "provider":     "slack",
            "access_token": token,
            "is_active":    True,
            "metadata":     {"workspace_name": workspace, "workspace_id": "local"},
        }, on_conflict="user_id,provider").execute()
        logger.info(f"Slack bot token saved for user {user_id}")

    def load_tokens(self, user_id: str) -> str:
        # Priority 1: env var (simplest local dev path)
        if self.bot_token:
            return self.bot_token

        # Priority 2: Supabase row
        try:
            sb  = self._sb()
            row = (
                sb.table("integration_accounts")
                .select("access_token")
                .eq("user_id", user_id)
                .eq("provider", "slack")
                .single()
                .execute()
            )
            token = row.data.get("access_token", "")
            if not token:
                raise ValueError("No Slack token found — connect Slack first")
            return token
        except Exception as e:
            msg = str(e)
            if "no rows" in msg.lower() or "PGRST116" in msg:
                raise ValueError(
                    "Slack not connected. Use the Connect button to add your bot token."
                )
            raise

    def list_channels(self, token: str) -> list[dict]:
        client = WebClient(token=token)
        resp   = client.conversations_list(types="public_channel", limit=100)
        return [
            {"id": ch["id"], "name": ch["name"], "member_count": ch.get("num_members", 0)}
            for ch in resp.get("channels", [])
        ]

    def fetch_messages(self, token: str, channel: str = None, limit: int = 50) -> list[dict]:
        client = WebClient(token=token)

        if not channel:
            try:
                chs = client.conversations_list(types="public_channel", limit=10).get("channels", [])
                # Pick first channel that has messages
                channel = chs[0]["id"] if chs else None
                if not channel:
                    return []
                logger.info(f"Slack: auto-selected channel {channel}")
            except Exception as e:
                logger.error(f"Slack channel list error: {e}")
                return []

        try:
            history = client.conversations_history(channel=channel, limit=limit)
        except Exception as e:
            logger.error(f"Slack history error: {e}")
            raise

        users_cache: dict = {}

        def _username(uid: str) -> str:
            if uid in users_cache:
                return users_cache[uid]
            try:
                info = client.users_info(user=uid)
                name = info["user"].get("real_name") or info["user"].get("name", uid)
            except Exception:
                name = uid
            users_cache[uid] = name
            return name

        messages = []
        for msg in history.get("messages", []):
            if msg.get("type") != "message" or msg.get("subtype"):
                continue
            text = msg.get("text", "").strip()
            if len(text) < 5:
                continue
            uid  = msg.get("user", "")
            messages.append({
                "id":          msg.get("ts", ""),
                "channel":     channel,
                "user_id":     uid,
                "user_name":   _username(uid) if uid else "Unknown",
                "text":        text,
                "timestamp":   msg.get("ts", ""),
                "thread_count":msg.get("reply_count", 0),
                "reactions":   [r.get("name", "") for r in msg.get("reactions", [])],
                "type":        "slack",
                "content":     text,
                "metadata":    {"channel": channel, "ts": msg.get("ts", "")},
            })

        logger.info(f"Slack: {len(messages)} messages from {channel}")
        return messages