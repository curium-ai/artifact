import secrets
import time
from urllib.parse import urlencode

import httpx
from database import lock_writes, transaction
from fastmcp.server.auth import AccessToken, OAuthProvider
from fastmcp.server.auth.auth import AuthorizationCode, ClientRegistrationOptions, RefreshToken
from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from models import OAuthAccess, OAuthRefresh
from pydantic import AnyUrl
from sqlalchemy import select
from stores import TokenStore, digest, get_user

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

SESSION_TTL = 86400  # 24 hours; clients refresh without another Google login


class ArtifactOAuthProvider(OAuthProvider):
    """MCP OAuth provider that delegates identity to Google Sign-In
    and gates access on the configured email domain."""

    def __init__(
        self,
        base_url: str,
        google_client_id: str,
        google_client_secret: str,
        allowed_domain: str,
        db_path: str | None = None,
    ):
        super().__init__(
            base_url=base_url,
            client_registration_options=ClientRegistrationOptions(enabled=True),
        )
        self.google_client_id = google_client_id
        self.google_client_secret = google_client_secret
        self.allowed_domain = allowed_domain.lower()

        # Credentials and in-flight authorization survive restarts in Postgres.
        self._store = TokenStore(db_path)

    # -- client registration --------------------------------------------------

    async def get_client(self, client_id: str) -> OAuthClientInformationFull | None:
        return self._store.get_client(client_id)

    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        if client_info.client_id:
            self._store.save_client(client_info)

    # -- authorization ---------------------------------------------------------

    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        google_state = secrets.token_urlsafe(32)
        pending = {
            "client_id": client.client_id,
            "redirect_uri": str(params.redirect_uri),
            "mcp_state": params.state,
            "code_challenge": params.code_challenge,
            "redirect_uri_provided_explicitly": params.redirect_uri_provided_explicitly,
            "scopes": params.scopes or [],
            "resource": params.resource,
            "expires": time.time() + 600,
        }

        self._store.save_flow(google_state, pending, pending["expires"])

        callback_url = str(self.base_url).rstrip("/") + "/google/callback"
        google_params = {
            "client_id": self.google_client_id,
            "redirect_uri": callback_url,
            "response_type": "code",
            "scope": "openid email",
            "state": google_state,
        }
        return f"{GOOGLE_AUTH_URL}?{urlencode(google_params)}"

    async def handle_google_callback(self, code: str, state: str) -> tuple[str, str, str | None]:
        """Exchange Google auth code, verify domain, return (mcp_code, redirect_uri, mcp_state)."""
        pending = self._store.flow(state, consume=True)
        if not pending or time.time() > pending["expires"]:
            raise ValueError("Invalid or expired authorization state")

        callback_url = str(self.base_url).rstrip("/") + "/google/callback"

        async with httpx.AsyncClient() as http:
            token_resp = await http.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self.google_client_id,
                    "client_secret": self.google_client_secret,
                    "redirect_uri": callback_url,
                    "grant_type": "authorization_code",
                },
            )
            token_resp.raise_for_status()
            tokens = token_resp.json()

            info_resp = await http.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            info_resp.raise_for_status()
            userinfo = info_resp.json()

        email = userinfo.get("email", "")
        domain = email.split("@")[-1].lower()
        if not userinfo.get("email_verified") or not userinfo.get("sub"):
            raise PermissionError("A verified Google identity is required")
        if domain != self.allowed_domain:
            raise PermissionError(f"Only @{self.allowed_domain} accounts are allowed")

        with transaction() as db:
            lock_writes(db)
            get_user(db, email, userinfo["sub"], userinfo.get("name"))

        mcp_code = secrets.token_urlsafe(32)
        authorization = AuthorizationCode(
            code=mcp_code,
            scopes=pending["scopes"],
            expires_at=time.time() + 300,
            client_id=pending["client_id"],
            code_challenge=pending["code_challenge"],
            redirect_uri=AnyUrl(pending["redirect_uri"]),
            redirect_uri_provided_explicitly=pending["redirect_uri_provided_explicitly"],
            resource=pending["resource"],
        )
        self._store.save_flow(mcp_code, {"authorization": authorization.model_dump(mode="json"), "email": email},
                              authorization.expires_at)

        return mcp_code, pending["redirect_uri"], pending.get("mcp_state")

    # -- authorization code exchange -------------------------------------------

    async def load_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: str
    ) -> AuthorizationCode | None:
        data = self._store.flow(authorization_code)
        ac = AuthorizationCode.model_validate(data["authorization"]) if data else None
        return ac if ac and ac.client_id == client.client_id else None

    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        data = self._store.flow(authorization_code.code, consume=True)
        if not data:
            raise ValueError("Authorization code expired or already used")
        email = data["email"]

        access_token = secrets.token_urlsafe(32)
        self._store.save_access_token(AccessToken(
            token=access_token,
            client_id=client.client_id or "",
            scopes=authorization_code.scopes,
            expires_at=int(time.time()) + SESSION_TTL,
            claims={"email": email},
        ))

        refresh_token = secrets.token_urlsafe(32)
        self._store.save_refresh_token(RefreshToken(
            token=refresh_token,
            client_id=client.client_id or "",
            scopes=authorization_code.scopes,
        ), email)

        return OAuthToken(
            access_token=access_token,
            token_type="Bearer",
            expires_in=SESSION_TTL,
            refresh_token=refresh_token,
        )

    # -- token validation & refresh --------------------------------------------

    async def load_access_token(self, token: str) -> AccessToken | None:
        return self._store.get_access_token(token)

    async def load_refresh_token(
        self, client: OAuthClientInformationFull, refresh_token: str
    ) -> RefreshToken | None:
        token = self._store.get_refresh_token(refresh_token)
        return token if token and token.client_id == client.client_id else None

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        # Consume and replace refresh credentials in one transaction. Concurrent
        # refreshes cannot both spend the same token or lose it halfway through.
        with transaction() as db:
            row = db.scalar(select(OAuthRefresh).where(
                OAuthRefresh.token == digest(refresh_token.token)).with_for_update())
            if not row or row.data["client_id"] != client.client_id:
                raise ValueError("Invalid refresh token; reconnect this client")
            get_user(db, row.email)
            if not set(scopes).issubset(set(refresh_token.scopes)):
                raise ValueError("Refresh cannot expand scopes")
            new_access, new_refresh = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            at = AccessToken(token=new_access, client_id=client.client_id or "",
                             scopes=scopes or refresh_token.scopes,
                             expires_at=int(time.time()) + SESSION_TTL, claims={"email": row.email})
            rt = RefreshToken(token=new_refresh, client_id=client.client_id or "", scopes=at.scopes)
            db.add(OAuthAccess(token=digest(new_access), data=at.model_dump(mode="json", exclude={"token"}),
                               expires_at=at.expires_at))
            db.add(OAuthRefresh(token=digest(new_refresh), data=rt.model_dump(mode="json", exclude={"token"}),
                                email=row.email))
            db.delete(row)
        return OAuthToken(access_token=new_access, token_type="Bearer", expires_in=SESSION_TTL,
                          refresh_token=new_refresh)

    # -- revocation ------------------------------------------------------------

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        if isinstance(token, AccessToken):
            self._store.delete_access_token(token.token)
        elif isinstance(token, RefreshToken):
            self._store.delete_refresh_token(token.token)
