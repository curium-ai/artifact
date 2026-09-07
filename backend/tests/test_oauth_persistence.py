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


def test_browser_approval_is_required_and_single_use(monkeypatch):
    import re
    from urllib.parse import urlencode

    import mcp_server
    from starlette.requests import Request

    one = provider()
    monkeypatch.setattr(mcp_server, "auth_provider", one)
    one._store.save_client(client().model_copy(update={"client_name": "<untrusted client>"}))
    one._store.save_flow(
        "approved-code",
        {"authorization": {"client_id": "test-client"}, "email": "alice@example.test"},
        time.time() + 300,
    )

    async def callback(code, state):
        return "approved-code", "http://localhost:1234/callback", "client-state"

    monkeypatch.setattr(one, "handle_google_callback", callback)

    async def flow():
        request = Request(
            {"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b"code=google&state=state"}
        )
        page = await mcp_server.google_callback(request)
        markup = page.body.decode()
        assert page.status_code == 200
        assert "Connect client" in markup and "&lt;untrusted client&gt;" in markup
        assert "approved-code" not in markup
        approval = re.search(r'name="consent" value="([A-Za-z0-9_-]+)"', markup).group(1)

        async def post():
            body = urlencode({"consent": approval, "decision": "allow"}).encode()

            async def receive():
                return {"type": "http.request", "body": body, "more_body": False}

            request = Request(
                {
                    "type": "http",
                    "method": "POST",
                    "path": "/",
                    "headers": [(b"content-type", b"application/x-www-form-urlencoded")],
                },
                receive,
            )
            return await mcp_server.approve_client(request)

        response = await post()
        assert response.status_code == 200
        assert "location" not in response.headers
        markup = response.body.decode()
        destination = "http://localhost:1234/callback?code=approved-code&amp;state=client-state"
        assert f'content="0;url={destination}"' in markup
        assert f'href="{destination}"' in markup
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert "form-action 'none'" in response.headers["content-security-policy"]
        assert (await post()).status_code == 400

    asyncio.run(flow())


def test_session_renewal_mints_cookie_and_logout_revokes_family():
    from models import WebSession

    one = SessionStore()
    ttl = 30 * 86400
    one.save("old-web-cookie", "alice@example.test", time.time() + ttl - 2 * 86400)
    renewed = one.renew("old-web-cookie", ttl)
    assert renewed["cookie"] and renewed["cookie"] != "old-web-cookie"
    assert one.get(renewed["cookie"])["user_id"] == one.get("old-web-cookie")["user_id"]
    with transaction() as db:
        assert db.get(WebSession, digest("old-web-cookie")).expires_at < time.time() + 61
    assert one.renew(renewed["cookie"], ttl)["cookie"] is None
    one.delete(renewed["cookie"])
    assert one.get("old-web-cookie") is None
    assert one.get(renewed["cookie"]) is None
