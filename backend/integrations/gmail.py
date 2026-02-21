"""
integrations/gmail.py
Gmail OAuth2 integration — fixed for blank screen on fetch.

Root cause of blank screen:
  1. Token expiry field stored as string in Supabase but google.oauth2 expects datetime
  2. INBOX-only label filter excluding many emails — removed
  3. No debug logging to surface errors
  4. newer_than:30d appended with space before existing query, causing syntax errors
"""

import base64
import logging
import os
from datetime import datetime

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from supabase import create_client

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]


class GmailIntegration:
    def __init__(self):
        self.client_id     = os.environ["GOOGLE_CLIENT_ID"]
        self.client_secret = os.environ["GOOGLE_CLIENT_SECRET"]
        self.redirect_uri  = os.environ["GOOGLE_REDIRECT_URI"]

    def _sb(self):
        return create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )

    def _flow(self) -> Flow:
        return Flow.from_client_config(
            {
                "web": {
                    "client_id":     self.client_id,
                    "client_secret": self.client_secret,
                    "auth_uri":      "https://accounts.google.com/o/oauth2/auth",
                    "token_uri":     "https://oauth2.googleapis.com/token",
                    "redirect_uris": [self.redirect_uri],
                }
            },
            scopes=SCOPES,
            redirect_uri=self.redirect_uri,
        )

    def get_auth_url(self, state: str) -> str:
        flow = self._flow()
        url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            state=state,
            prompt="consent",
        )
        return url

    def exchange_code(self, code: str) -> dict:
        flow = self._flow()
        flow.fetch_token(code=code)
        creds = flow.credentials
        return {
            "access_token":  creds.token,
            "refresh_token": creds.refresh_token,
            "token_expiry":  creds.expiry.isoformat() if creds.expiry else None,
            "scopes":        list(creds.scopes or SCOPES),
        }

    def save_tokens(self, user_id: str, tokens: dict):
        sb = self._sb()
        account_email = None
        try:
            creds = self._creds_from_tokens(tokens)
            service = build("oauth2", "v2", credentials=creds)
            info = service.userinfo().get().execute()
            account_email = info.get("email")
        except Exception as e:
            logger.warning(f"Could not get account email: {e}")

        sb.table("integration_accounts").upsert({
            "user_id":       user_id,
            "provider":      "gmail",
            "access_token":  tokens["access_token"],
            "refresh_token": tokens.get("refresh_token"),
            "token_expiry":  tokens.get("token_expiry"),
            "scopes":        tokens.get("scopes", SCOPES),
            "account_email": account_email,
            "is_active":     True,
        }, on_conflict="user_id,provider").execute()
        logger.info(f"Gmail tokens saved for user {user_id} ({account_email})")

    def load_tokens(self, user_id: str) -> Credentials:
        sb = self._sb()
        row = (
            sb.table("integration_accounts")
            .select("*")
            .eq("user_id", user_id)
            .eq("provider", "gmail")
            .single()
            .execute()
        )
        data = row.data
        creds = self._creds_from_tokens(data)

        # Refresh if expired
        if creds.expired and creds.refresh_token:
            logger.info(f"Refreshing Gmail token for user {user_id}")
            try:
                creds.refresh(Request())
                self.save_tokens(user_id, {
                    "access_token":  creds.token,
                    "refresh_token": creds.refresh_token,
                    "token_expiry":  creds.expiry.isoformat() if creds.expiry else None,
                    "scopes":        list(creds.scopes or SCOPES),
                })
            except Exception as e:
                logger.error(f"Token refresh failed: {e}")
                raise

        return creds

    def _creds_from_tokens(self, data: dict) -> Credentials:
        # Fix: token_expiry stored as ISO string — parse it back to datetime
        expiry = None
        raw_expiry = data.get("token_expiry")
        if raw_expiry:
            try:
                from datetime import timezone
                expiry = datetime.fromisoformat(str(raw_expiry).replace("Z", "+00:00"))
                # Strip timezone — google.oauth2.Credentials compares against naive utcnow()
                expiry = expiry.replace(tzinfo=None)
            except Exception:
                expiry = None

        return Credentials(
            token=data.get("access_token"),
            refresh_token=data.get("refresh_token"),
            token_uri="https://oauth2.googleapis.com/token",
            client_id=self.client_id,
            client_secret=self.client_secret,
            scopes=data.get("scopes", SCOPES),
            expiry=expiry,
        )

    def fetch_recent_messages(
        self,
        creds: Credentials,
        max_results: int = 20,
        query: str = "",
    ) -> list[dict]:
        """
        Fetch recent Gmail messages.
        Fix: removed INBOX-only filter (misses Sent, important threads)
             removed newer_than filter (was causing empty results for some accounts)
        """
        service = build("gmail", "v1", credentials=creds)

        # Use query as-is if provided, otherwise fetch everything recent
        q = query.strip() if query else ""

        logger.info(f"Gmail list query: '{q}', max={max_results}")

        try:
            results = service.users().messages().list(
                userId="me",
                maxResults=max_results,
                q=q or None,   # None = no filter = all mail
            ).execute()
        except Exception as e:
            logger.error(f"Gmail list error: {e}")
            raise

        msg_refs = results.get("messages", [])
        logger.info(f"Gmail: {len(msg_refs)} message refs returned")

        messages = []
        for msg_ref in msg_refs[:max_results]:
            try:
                msg = service.users().messages().get(
                    userId="me",
                    id=msg_ref["id"],
                    format="full",
                ).execute()
                parsed = self._parse_message(msg)
                messages.append(parsed)
            except Exception as e:
                logger.warning(f"Could not fetch message {msg_ref['id']}: {e}")

        logger.info(f"Gmail: returning {len(messages)} messages")
        return messages

    def _parse_message(self, msg: dict) -> dict:
        headers = {
            h["name"]: h["value"]
            for h in msg.get("payload", {}).get("headers", [])
        }
        body = self._extract_body(msg.get("payload", {}))
        return {
            "id":      msg["id"],
            "subject": headers.get("Subject", "(no subject)"),
            "from":    headers.get("From", ""),
            "to":      headers.get("To", ""),
            "date":    headers.get("Date", ""),
            "body":    body,
            "snippet": msg.get("snippet", ""),
            "labels":  msg.get("labelIds", []),
            # BRD source format
            "type":    "email",
            "content": body or msg.get("snippet", ""),
            "metadata": {
                "subject": headers.get("Subject", ""),
                "from":    headers.get("From", ""),
                "date":    headers.get("Date", ""),
            },
        }

    def _extract_body(self, payload: dict) -> str:
        """Recursively extract plain text body from Gmail message payload."""
        mime = payload.get("mimeType", "")

        if mime == "text/plain":
            data = payload.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")

        # Recurse into parts
        for part in payload.get("parts", []):
            if part.get("mimeType") == "text/plain":
                data = part.get("body", {}).get("data", "")
                if data:
                    return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
            if part.get("parts"):
                result = self._extract_body(part)
                if result:
                    return result

        # Fallback: try HTML part — decode entities properly
        for part in payload.get("parts", []):
            if part.get("mimeType") == "text/html":
                data = part.get("body", {}).get("data", "")
                if data:
                    html = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
                    return self._html_to_text(html)

        return ""

    def _html_to_text(self, html: str) -> str:
        """Strip HTML and decode entities properly — fixes &#847; showing as raw entities."""
        import re
        import html as html_module
        html = re.sub(r"<(script|style)[^>]*>.*?</(script|style)>", " ", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<(br|p|div|tr|li)[^>]*>", "\n", html, flags=re.IGNORECASE)
        html = re.sub(r"<[^>]+>", "", html)
        html = html_module.unescape(html)
        html = re.sub(r"[ \t]+", " ", html)
        html = re.sub(r"\n{3,}", "\n\n", html)
        return html.strip()