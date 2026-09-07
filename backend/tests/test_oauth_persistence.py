import asyncio
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from database import transaction
from fastmcp.server.auth import AccessToken
from fastmcp.server.auth.auth import RefreshToken
from mcp.server.auth.provider import AuthorizationParams
from mcp.shared.auth import OAuthClientInformationFull
from mcp_auth import ArtifactOAuthProvider
from models import OAuthAccess, OAuthRefresh
from pydantic import AnyUrl
from stores import SessionStore, digest, get_user


def provider():
    return ArtifactOAuthProvider(
        base_url="https://artifact.example/mcp",
        google_client_id="google-test",
        google_client_secret="test-secret",
        allowed_domain="example.test",
    )


def client():
    return OAuthClientInformationFull(
        client_id="test-client",
        redirect_uris=[AnyUrl("http://localhost:1234/callback")],
        token_endpoint_auth_method="none",
    )


def test_web_session_identity_persists_and_slides():
    first, second = SessionStore(), SessionStore()
    first.save("web-test", "alice@example.test", time.time() + 100, sub="google-sub-123")
    assert first.get("web-test")["user_id"] == second.get("web-test")["user_id"]
    second.touch("web-test", time.time() + 500)
    assert first.get("web-test")["expiry"] > time.time() + 400
    second.delete("web-test")
    assert first.get("web-test") is None


def test_pending_oauth_and_codes_survive_provider_restart(monkeypatch):
    original_client = httpx.AsyncClient

    def upstream(request):
        if request.url.path == "/token":
            return httpx.Response(200, json={"access_token": "google-access"})
        return httpx.Response(200, json={"email": "alice@example.test", "sub": "subject123", "email_verified": True})

    monkeypatch.setattr("mcp_auth.httpx.AsyncClient", lambda: original_client(transport=httpx.MockTransport(upstream)))

    async def flow():
        one, two = provider(), provider()
        await one.register_client(client())
        assert (await two.get_client("test-client")).client_id == "test-client"
        location = await one.authorize(
            client(),
            AuthorizationParams(
                state="mcp-state",
                scopes=[],
                code_challenge="challenge",
                redirect_uri=AnyUrl("http://localhost:1234/callback"),
                redirect_uri_provided_explicitly=True,
            ),
        )
        query = parse_qs(urlparse(location).query)
        assert "prompt" not in query and "access_type" not in query
        code, _, state = await two.handle_google_callback("google-code", query["state"][0])
        assert state == "mcp-state"
        three = provider()
        authorization = await three.load_authorization_code(client(), code)
        tokens = await three.exchange_authorization_code(client(), authorization)
        assert (await one.load_access_token(tokens.access_token)).claims["email"] == "alice@example.test"
        assert await one.load_authorization_code(client(), code) is None

    asyncio.run(flow())


def test_refresh_rotation_is_atomic_and_bound_to_client():
    one = provider()
    with transaction() as db:
        get_user(db, "alice@example.test")
    one._store.save_refresh_token(
        RefreshToken(token="old-refresh", client_id="test-client", scopes=["read"]), "alice@example.test"
    )

    async def rotate():
        two = provider()
        wrong = client().model_copy(update={"client_id": "another-client"})
        assert await two.load_refresh_token(wrong, "old-refresh") is None
        refresh = await two.load_refresh_token(client(), "old-refresh")
        with pytest.raises(ValueError):
            await two.exchange_refresh_token(client(), refresh, ["write"])
        assert await one.load_refresh_token(client(), "old-refresh") is not None
        result = await two.exchange_refresh_token(client(), refresh, ["read"])
        assert await one.load_refresh_token(client(), "old-refresh") is None
        assert await one.load_refresh_token(client(), result.refresh_token) is not None
        assert await one.load_access_token(result.access_token) is not None
        with transaction() as db:
            assert "token" not in db.get(OAuthRefresh, digest(result.refresh_token)).data
            assert "token" not in db.get(OAuthAccess, digest(result.access_token)).data
        await one.revoke_token(RefreshToken(token=result.refresh_token, client_id="test-client", scopes=["read"]))
        assert await two.load_refresh_token(client(), result.refresh_token) is None

    asyncio.run(rotate())


def test_expired_access_is_rejected():
    one = provider()
    one._store.save_access_token(
        AccessToken(token="expired", client_id="test-client", scopes=[], expires_at=int(time.time()) - 1)
    )
    assert asyncio.run(one.load_access_token("expired")) is None
