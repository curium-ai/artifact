import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

from artifacts import artifact_for_path, object_path, relocate, remove, resolve
from collaboration_api import router as collaboration_router
from database import engine
from dotenv import load_dotenv
from fastapi import Cookie, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from settings import COOKIE_SECURE, MAX_FILE_BYTES
from sqlalchemy import text
from stores import SessionStore
from uploads import browser_upload
from uploads import router as upload_router

load_dotenv()

app = FastAPI(title="Artifact")
app.include_router(upload_router)
app.include_router(collaboration_router)

UPLOAD_DIR = Path(os.environ.get("ARTIFACT_UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "uploads")))
PASSWORD = os.environ.get("ARTIFACT_PASSWORD", "artifact")
MAX_FILE_SIZE = MAX_FILE_BYTES
FRONTEND_DIR = Path(os.environ.get("ARTIFACT_FRONTEND_DIR", os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")))

AUTH_MODE = os.environ.get("ARTIFACT_AUTH_MODE", "password")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
ALLOWED_DOMAIN = os.environ.get("ARTIFACT_ALLOWED_DOMAIN", "")

SESSION_TTL = 30 * 86400  # 30 days; slides forward on each visit (see auth_status)


session_store = SessionStore()

MCP_TOKEN = os.environ.get("ARTIFACT_MCP_TOKEN", "")


def resolve_path(user_path: str) -> Path:
    return resolve(user_path)


def is_authenticated(session_token: str | None) -> bool:
    if not session_token:
        return False
    return session_store.get(session_token) is not None


def get_session_email(session_token: str | None) -> str | None:
    if not session_token:
        return None
    session = session_store.get(session_token)
    return session.get("email") if session else None


def require_auth(session_token: str | None):
    if not is_authenticated(session_token):
        raise HTTPException(status_code=401, detail="Authentication required")


# Mount MCP server at /mcp
_mcp_app = None
try:
    from mcp_server import create_mcp_app
    from starlette.routing import Route as _StarletteRoute
    _mcp_app = create_mcp_app()

    # RFC 8414/9728: well-known discovery endpoints must be reachable at the
    # origin level (/.well-known/...), not behind the /mcp mount prefix.
    # Extract them from the MCP app and register on the main app.
    for _route in list(_mcp_app.routes):
        if isinstance(_route, _StarletteRoute) and _route.path.startswith("/.well-known/"):
            app.routes.insert(0, _route)
            # Add RFC 8414 path-aware variant so clients that compute
            # /.well-known/oauth-authorization-server/mcp also find it
            if not _route.path.rstrip("/").endswith("/mcp"):
                app.routes.insert(0, _StarletteRoute(
                    _route.path.rstrip("/") + "/mcp",
                    endpoint=_route.endpoint,
                    methods=_route.methods,
                ))

    app.mount("/mcp", _mcp_app)

    # Starlette mounts only match the prefix WITH a trailing slash (/mcp/),
    # so a bare POST /mcp falls through to the frontend SPA catch-all and
    # returns 405. MCP clients (e.g. claude.ai) connect to the URL exactly as
    # configured (".../mcp", no slash) and POST JSON-RPC there. This pure-ASGI
    # middleware rewrites the bare "/mcp" path to "/mcp/" before routing, so it
    # reaches the mounted MCP app. Pure ASGI (not BaseHTTPMiddleware) so it does
    # not buffer the streamable-http SSE response.
    class _MCPTrailingSlash:
        def __init__(self, asgi_app):
            self.asgi_app = asgi_app

        async def __call__(self, scope, receive, send):
            if scope.get("type") == "http" and scope.get("path") == "/mcp":
                scope = dict(scope)
                scope["path"] = "/mcp/"
                if scope.get("raw_path"):
                    scope["raw_path"] = b"/mcp/"
            await self.asgi_app(scope, receive, send)

    app.add_middleware(_MCPTrailingSlash)

    # Without Google OAuth the MCP endpoint has no auth of its own. Gate it
    # with a static bearer token (ARTIFACT_MCP_TOKEN) when configured.
    from mcp_server import auth_provider as _mcp_auth_provider
    if _mcp_auth_provider is None:
        class _MCPBearerAuth:
            def __init__(self, asgi_app):
                self.asgi_app = asgi_app

            async def __call__(self, scope, receive, send):
                path = scope.get("path", "")
                if scope.get("type") == "http" and (path == "/mcp" or path.startswith("/mcp/")):
                    provided = dict(scope.get("headers") or []).get(b"authorization", b"")
                    expected = f"Bearer {MCP_TOKEN}".encode()
                    if not MCP_TOKEN or not secrets.compare_digest(provided, expected):
                        await send({
                            "type": "http.response.start",
                            "status": 401,
                            "headers": [
                                (b"content-type", b"application/json"),
                                (b"www-authenticate", b"Bearer"),
                            ],
                        })
                        await send({
                            "type": "http.response.body",
                            "body": b'{"detail": "Unauthorized"}',
                        })
                        return
                await self.asgi_app(scope, receive, send)

        app.add_middleware(_MCPBearerAuth)

except Exception as e:
    raise RuntimeError("MCP server could not be initialized") from e


@asynccontextmanager
async def _lifespan(_app):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with engine.connect() as connection:
        connection.execute(text("SELECT version_num FROM alembic_version"))
    if AUTH_MODE == "google":
        if not GOOGLE_CLIENT_ID:
            raise RuntimeError("GOOGLE_CLIENT_ID is required when ARTIFACT_AUTH_MODE=google")
        if not ALLOWED_DOMAIN:
            raise RuntimeError("ARTIFACT_ALLOWED_DOMAIN is required when ARTIFACT_AUTH_MODE=google")

    if _mcp_app and hasattr(_mcp_app, "lifespan"):
        async with _mcp_app.lifespan(_app):
            yield
    else:
        yield

app.router.lifespan_context = _lifespan


@app.post("/api/auth/login")
async def login(request: Request, response: Response):
    if AUTH_MODE == "google":
        raise HTTPException(status_code=404, detail="Password login is disabled")
    body = await request.json()
    password = body.get("password", "")
    if password != PASSWORD:
        raise HTTPException(status_code=401, detail="Incorrect password")
    token = secrets.token_urlsafe(32)
    session_store.save(token, None, time.time() + SESSION_TTL)
    response.set_cookie(
        key="artifact_session",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_TTL,
    )
    return {"ok": True}


@app.post("/api/auth/google")
async def google_login(request: Request, response: Response):
    if AUTH_MODE != "google":
        raise HTTPException(status_code=404, detail="Google auth is not enabled")

    body = await request.json()
    credential = body.get("credential", "")
    if not credential:
        raise HTTPException(status_code=400, detail="Missing credential")

    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        idinfo = id_token.verify_oauth2_token(
            credential, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = idinfo.get("email", "")
    if not email or not idinfo.get("email_verified"):
        raise HTTPException(status_code=401, detail="No email in token")

    domain = email.split("@")[-1].lower()
    if domain != ALLOWED_DOMAIN.lower():
        raise HTTPException(
            status_code=403,
            detail=f"Only @{ALLOWED_DOMAIN} accounts are allowed",
        )

    token = secrets.token_urlsafe(32)
    session_store.save(token, email, time.time() + SESSION_TTL, idinfo.get("sub"), idinfo.get("name"))
    response.set_cookie(
        key="artifact_session",
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_TTL,
    )
    return {"ok": True, "email": email}


@app.post("/api/auth/logout")
def logout(response: Response, artifact_session: str | None = Cookie(None)):
    if artifact_session:
        session_store.delete(artifact_session)
    response.delete_cookie("artifact_session")
    return {"ok": True}


@app.get("/api/auth/status")
def auth_status(response: Response, artifact_session: str | None = Cookie(None)):
    session = session_store.renew(artifact_session, SESSION_TTL) if artifact_session else None
    authenticated = session is not None
    if session and session["cookie"]:
        response.set_cookie(
            key="artifact_session",
            value=session["cookie"],
            httponly=True,
            secure=COOKIE_SECURE,
            samesite="lax",
            max_age=SESSION_TTL,
        )
    result: dict = {
        "authenticated": authenticated,
        "authMode": AUTH_MODE,
        "maxFileBytes": MAX_FILE_BYTES,
    }
    if AUTH_MODE == "google":
        result["googleClientId"] = GOOGLE_CLIENT_ID
        result["allowedDomain"] = ALLOWED_DOMAIN
    if authenticated:
        result["email"] = session["email"]
        result["userId"] = session["user_id"]
    return result


def format_time_ago(mtime: float) -> str:
    diff = time.time() - mtime
    if diff < 60:
        return "just now"
    elif diff < 3600:
        n = int(diff / 60)
        return f"{n} minute{'s' if n != 1 else ''} ago"
    elif diff < 86400:
        n = int(diff / 3600)
        return f"{n} hour{'s' if n != 1 else ''} ago"
    elif diff < 604800:
        n = int(diff / 86400)
        return f"{n} day{'s' if n != 1 else ''} ago"
    elif diff < 2592000:
        n = int(diff / 604800)
        return f"{n} week{'s' if n != 1 else ''} ago"
    else:
        n = int(diff / 2592000)
        return f"{n} month{'s' if n != 1 else ''} ago"


def format_size(size_bytes: int) -> str:
    kb = size_bytes / 1024
    if kb >= 1024:
        return f"{kb / 1024:.1f} MB"
    return f"{kb:.0f} KB"


@app.get("/api/files")
def list_files(path: str = "/", artifact_session: str | None = Cookie(None)):
    require_auth(artifact_session)
    base = os.path.realpath(UPLOAD_DIR)
    candidate = os.path.realpath(resolve_path(path))
    if candidate == base:
        resolved = UPLOAD_DIR
    else:
        if not candidate.startswith(base + os.sep):
            raise HTTPException(400, "Invalid path")
        resolved = Path(candidate)
    if not resolved.exists():
        return {"folders": [], "files": []}
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")

    folders = []
    files = []
    for item in sorted(resolved.iterdir()):
        if item.name.startswith("."):
            continue
        if item.is_dir():
            folders.append(item.name)
        elif item.suffix.lower() == ".html":
            stat = item.stat()
            files.append({
                "name": item.name,
                "size": format_size(stat.st_size),
                "modified": format_time_ago(stat.st_mtime),
                "bytes": stat.st_size,
            })

    return {"folders": folders, "files": files}


@app.get("/api/tree")
def get_tree(artifact_session: str | None = Cookie(None)):
    require_auth(artifact_session)
    def walk(dir_path: Path, rel: str) -> list:
        result = []
        if not dir_path.exists():
            return result
        for item in sorted(dir_path.iterdir()):
            if item.name.startswith("."):
                continue
            if item.is_dir():
                sub_rel = f"{rel}/{item.name}" if rel != "/" else f"/{item.name}"
                children = walk(item, sub_rel)
                result.append({"name": item.name, "path": sub_rel, "children": children})
        return result

    return {"tree": walk(UPLOAD_DIR, "/")}


@app.post("/api/files/upload")
async def upload_files(
    request: Request,
    path: str = Query("/"),
    artifact_session: str | None = Cookie(None),
):
    require_auth(artifact_session)
    return await browser_upload(request, path, session_store.get(artifact_session)["user_id"])


@app.post("/api/folders")
async def create_folder(
    request: Request,
    artifact_session: str | None = Cookie(None),
):
    require_auth(artifact_session)
    body = await request.json()
    path = body.get("path", "/")
    name = body.get("name", "").strip()
    if not name or "/" in name:
        raise HTTPException(status_code=400, detail="Invalid folder name")
    resolved = resolve_path(path)
    folder_path = resolved / name
    if folder_path.exists():
        raise HTTPException(status_code=409, detail="Folder already exists")
    folder_path.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "name": name}


@app.post("/api/files/rename")
async def rename_item(
    request: Request,
    artifact_session: str | None = Cookie(None),
):
    require_auth(artifact_session)
    body = await request.json()
    path = body.get("path", "/")
    old_name = body.get("oldName", "")
    new_name = body.get("newName", "").strip()
    if not old_name or not new_name or "/" in new_name:
        raise HTTPException(status_code=400, detail="Invalid names")
    if "/" in old_name or "\\" in old_name:
        raise HTTPException(400, "Invalid filename")
    relocate(path.rstrip("/") + "/" + old_name, path.rstrip("/") + "/" + new_name)
    return {"ok": True}


@app.post("/api/files/move")
async def move_item(
    request: Request,
    artifact_session: str | None = Cookie(None),
):
    require_auth(artifact_session)
    body = await request.json()
    from_path = body.get("fromPath", "/")
    name = body.get("name", "")
    to_path = body.get("toPath", "/")
    if not name:
        raise HTTPException(status_code=400, detail="No item specified")
    if "/" in name or "\\" in name:
        raise HTTPException(400, "Invalid filename")
    relocate(from_path.rstrip("/") + "/" + name, to_path.rstrip("/") + "/" + name)
    return {"ok": True}


@app.delete("/api/files")
async def delete_item(
    request: Request,
    artifact_session: str | None = Cookie(None),
):
    require_auth(artifact_session)
    body = await request.json()
    path = body.get("path", "/")
    name = body.get("name", "")
    if not name or "/" in name or "\\" in name:
        raise HTTPException(400, "Invalid filename")
    remove(path.rstrip("/") + "/" + name)
    return {"ok": True}


def path_review_url(file_path: str) -> str:
    # Keep the destination in the SPA URL throughout authentication. Encode the
    # filename separately because it can contain query/fragment delimiters.
    resolve_path("/" + file_path)
    directory, _, name = file_path.rpartition("/")
    return "/browse" + ("/" + quote(directory, safe="/") if directory else "") + "?f=" + quote(name, safe="")


@app.get("/v/{file_path:path}")
def shared_review(file_path: str, artifact_session: str | None = Cookie(None)):
    destination = path_review_url(file_path)
    if is_authenticated(artifact_session):
        artifact = artifact_for_path("/" + file_path)
        destination = "/a/" + artifact.id
    return RedirectResponse(destination, status_code=302, headers={"Cache-Control": "no-store"})


@app.get("/raw/{file_path:path}")
def serve_original(file_path: str, artifact_session: str | None = Cookie(None)):
    if AUTH_MODE == "google" and not is_authenticated(artifact_session):
        return RedirectResponse(path_review_url(file_path), status_code=302, headers={"Cache-Control": "no-store"})
    artifact = artifact_for_path("/" + file_path)
    return FileResponse(object_path(artifact.current_revision_id), media_type="text/html",
                        headers={"Content-Security-Policy": "sandbox allow-scripts", "Cache-Control": "no-store"})


# Serve frontend static files in production
if FRONTEND_DIR.exists() and FRONTEND_DIR.is_dir():
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        base = os.path.realpath(FRONTEND_DIR)
        candidate = os.path.realpath(os.path.join(base, full_path))
        # candidate == base is GET / — falls through to the index.html fallback
        if candidate != base and not candidate.startswith(base + os.sep):
            raise HTTPException(status_code=404)
        file_path = Path(candidate)
        if file_path.is_file():
            media_type = None
            if file_path.suffix == ".js":
                media_type = "application/javascript"
            elif file_path.suffix == ".css":
                media_type = "text/css"
            elif file_path.suffix == ".html":
                media_type = "text/html"
            elif file_path.suffix == ".svg":
                media_type = "image/svg+xml"
            from fastapi.responses import FileResponse
            return FileResponse(file_path, media_type=media_type)
        index = FRONTEND_DIR / "index.html"
        if index.exists():
            return HTMLResponse(content=index.read_text())
        raise HTTPException(status_code=404)

    @app.get("/")
    async def serve_index():
        index = FRONTEND_DIR / "index.html"
        if index.exists():
            return HTMLResponse(content=index.read_text())
        raise HTTPException(status_code=404)
