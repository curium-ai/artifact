import hashlib
import html
import os
import secrets
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse

from artifacts import artifact_for_path, object_path, publish, relocate, remove, resolve, sync_alias
from database import lock_writes, transaction
from fastapi import HTTPException
from fastmcp import FastMCP
from fastmcp.server.dependencies import get_access_token
from mcp_auth import ArtifactOAuthProvider
from settings import MAX_FILE_BYTES, PUBLIC_URL
from starlette.requests import Request
from starlette.responses import HTMLResponse
from stores import get_user
from uploads import UploadRequest, prepare

UPLOAD_DIR = Path(
    os.environ.get(
        "ARTIFACT_UPLOAD_DIR",
        os.path.join(os.path.dirname(__file__), "uploads"),
    )
)
MAX_FILE_SIZE = MAX_FILE_BYTES

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
ALLOWED_DOMAIN = os.environ.get("ARTIFACT_ALLOWED_DOMAIN", "")
MCP_BASE_URL = os.environ.get("ARTIFACT_MCP_BASE_URL", PUBLIC_URL + "/mcp")


# ---------------------------------------------------------------------------
# Auth provider
# ---------------------------------------------------------------------------

auth_provider = None
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and ALLOWED_DOMAIN:
    auth_provider = ArtifactOAuthProvider(
        base_url=MCP_BASE_URL,
        google_client_id=GOOGLE_CLIENT_ID,
        google_client_secret=GOOGLE_CLIENT_SECRET,
        allowed_domain=ALLOWED_DOMAIN,
    )


# ---------------------------------------------------------------------------
# FastMCP server
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "artifact",
    instructions=(
        "Manage HTML files on Artifact. Files are organized in a folder tree. "
        f"Only .html files are supported, max {MAX_FILE_BYTES} bytes each. "
        "Paths use forward slashes and start from root /. "
        "To modify an existing file, prefer edit_file (exact string replacement) "
        "for small changes. "
        "For uploads and replacements, write the file locally, calculate its byte size and SHA-256, "
        "then call prepare_upload. Transfer the file directly to the returned URL using curl --upload-file. "
        "Never send whole document contents through tool arguments. "
        "To read a document from an Artifact share link (https://<host>/v/...), "
        "use read_file_from_url."
    ),
    auth=auth_provider,
)


# ---------------------------------------------------------------------------
# Google OAuth callback (custom HTTP route on the MCP app)
# ---------------------------------------------------------------------------

@mcp.custom_route("/google/callback", methods=["GET"])
async def google_callback(request: Request):
    if not auth_provider:
        return HTMLResponse("<h1>OAuth not configured</h1>", status_code=500)

    code = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error")

    if error:
        return HTMLResponse(
            f"<h1>Authentication failed</h1><p>{html.escape(error)}</p>", status_code=403
        )
    if not code or not state:
        return HTMLResponse(
            "<h1>Bad request</h1><p>Missing code or state</p>", status_code=400
        )

    try:
        mcp_code, redirect_uri, mcp_state = await auth_provider.handle_google_callback(
            code, state
        )
    except PermissionError as e:
        return HTMLResponse(
            f"<h1>Access denied</h1><p>{html.escape(str(e))}</p>", status_code=403
        )
    except (ValueError, RuntimeError) as e:
        return HTMLResponse(
            f"<h1>Authentication error</h1><p>{html.escape(str(e))}</p>", status_code=400
        )

    data = auth_provider._store.flow(mcp_code)
    client = await auth_provider.get_client(data["authorization"]["client_id"])
    consent = secrets.token_urlsafe(32)
    auth_provider._store.save_flow(consent, {"code": mcp_code, "redirect_uri": redirect_uri, "state": mcp_state},
                                  time.time() + 300)
    name = html.escape(client.client_name or "MCP client")
    destination = html.escape(urlparse(redirect_uri).netloc or redirect_uri)
    email = html.escape(data["email"])
    # Client approval is explicit even when Google already remembers this browser.
    return HTMLResponse(
        f"""<!doctype html><html><head><title>Connect to Artifact</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{{font:16px system-ui;background:#f3efea;color:#151515;padding:40px}}
        main{{max-width:480px;margin:8vh auto;padding:32px;background:white;border-radius:12px}}
        p{{line-height:1.6}}button{{padding:12px 18px;margin:8px 8px 0 0;cursor:pointer}}</style></head>
        <body><main><h1>Connect {name}?</h1><p>Signed in as {email}.</p>
        <p>This client can read, upload, edit, move, and delete files in this Artifact workspace.</p>
        <p>Authorization will return to <strong>{destination}</strong>.</p>
        <form method="post" action="/mcp/consent">
        <input type="hidden" name="consent" value="{consent}">
        <button name="decision" value="allow">Connect client</button>
        <button name="decision" value="deny">Cancel</button></form></main></body></html>""",
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                 "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"},
    )


@mcp.custom_route("/consent", methods=["POST"])
async def approve_client(request: Request):
    if not auth_provider:
        return HTMLResponse("OAuth not configured", status_code=404)
    async with request.form(max_fields=2, max_files=0) as form:
        token, decision = form.get("consent"), form.get("decision")
    if not isinstance(token, str) or decision not in ("allow", "deny"):
        return HTMLResponse("Invalid approval", status_code=400)
    data = auth_provider._store.flow(token, consume=True)
    if not data or "code" not in data:
        return HTMLResponse("This approval link has already been used or expired. Reconnect your client to start again.", status_code=400)
    if decision == "deny":
        auth_provider._store.flow(data["code"], consume=True)
        return HTMLResponse("Connection canceled. You can close this window.")
    if not auth_provider._store.flow(data["code"]):
        return HTMLResponse("Authorization expired. Reconnect your client.", status_code=400)
    params = {"code": data["code"]}
    if data["state"]:
        params["state"] = data["state"]
    uri = data["redirect_uri"]
    separator = "&" if "?" in uri else "?"
    destination = html.escape(uri + separator + urlencode(params), quote=True)
    # A form-action 'self' policy also covers HTTP redirects in Chromium.
    # Finish the same-origin POST before navigating to the registered callback.
    # Keep a visible link for browsers that don't follow the automatic refresh.
    return HTMLResponse(
        f"""<!doctype html><html><head><title>Return to your client</title>
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta http-equiv="refresh" content="0;url={destination}">
        <style>body{{font:16px system-ui;background:#f3efea;color:#151515;padding:40px}}
        main{{max-width:480px;margin:8vh auto;padding:32px;background:white;border-radius:12px}}
        p{{line-height:1.6}}</style></head><body><main><h1>Client approved</h1>
        <p>Returning to your client to finish connecting.</p>
        <p>If nothing happens, <a href="{destination}" rel="noreferrer">return to your client</a>.</p>
        </main></body></html>""",
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
                 "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'"},
    )


# ---------------------------------------------------------------------------
# Path helpers (mirrors backend/main.py resolve_path)
# ---------------------------------------------------------------------------

def _resolve(user_path: str) -> Path:
    try:
        return resolve(user_path)
    except HTTPException as error:
        raise ValueError(error.detail) from error


def _format_size(size_bytes: int) -> str:
    kb = size_bytes / 1024
    if kb >= 1024:
        return f"{kb / 1024:.1f} MB"
    return f"{kb:.0f} KB"


def _format_time_ago(ts: float) -> str:
    diff = time.time() - ts
    if diff < 60:
        return "just now"
    if diff < 3600:
        m = int(diff / 60)
        return f"{m} minute{'s' if m != 1 else ''} ago"
    if diff < 86400:
        h = int(diff / 3600)
        return f"{h} hour{'s' if h != 1 else ''} ago"
    d = int(diff / 86400)
    return f"{d} day{'s' if d != 1 else ''} ago"


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def list_files(path: str = "/") -> dict:
    """List folders and HTML files at the given directory path."""
    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    if not resolved.exists():
        return {"folders": [], "files": []}
    if not resolved.is_dir():
        return {"error": "not_a_directory", "detail": f"{path} is not a directory"}

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
                "size": _format_size(stat.st_size),
                "modified": _format_time_ago(stat.st_mtime),
                "bytes": stat.st_size,
            })

    return {"folders": folders, "files": files}


@mcp.tool()
def get_file_tree() -> dict:
    """Get the complete folder tree structure."""
    def walk(dir_path: Path, rel: str) -> list:
        result = []
        if not dir_path.exists():
            return result
        for item in sorted(dir_path.iterdir()):
            if item.name.startswith("."):
                continue
            if item.is_dir():
                sub_rel = f"{rel}/{item.name}" if rel != "/" else f"/{item.name}"
                result.append({"name": item.name, "path": sub_rel, "children": walk(item, sub_rel)})
        return result

    return {"tree": walk(UPLOAD_DIR, "/")}


def _read_file(path: str) -> dict:
    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    if not resolved.exists() or not resolved.is_file():
        return {"error": "not_found", "detail": f"File {path} not found"}
    if resolved.suffix.lower() != ".html":
        return {"error": "validation_error", "detail": "Only .html files can be read"}

    stat = resolved.stat()
    return {
        "name": resolved.name,
        "path": path,
        "content": object_path(artifact_for_path(path).current_revision_id).read_text(encoding="utf-8", errors="replace"),
        "size": _format_size(stat.st_size),
        "modified": _format_time_ago(stat.st_mtime),
        "bytes": stat.st_size,
    }


@mcp.tool()
def read_file(path: str) -> dict:
    """Read an HTML file's content. path should be like /folder/file.html"""
    return _read_file(path)


@mcp.tool()
def read_file_from_url(url: str) -> dict:
    """Read the Artifact document behind a share link (https://<host>/v/<path>)."""
    from urllib.parse import unquote, urlparse

    path = unquote(urlparse(url).path)
    if not path.startswith("/v/"):
        return {
            "error": "validation_error",
            "detail": "Only Artifact share links (https://<host>/v/<path>) are supported",
        }
    return _read_file(path[2:])  # strip "/v", keep leading slash


def actor_id():
    token = get_access_token()
    if auth_provider and not token:
        raise PermissionError("MCP authentication required")
    email = token.claims.get("email") if token else None
    with transaction() as db:
        lock_writes(db)
        return get_user(db, email).id


@mcp.tool()
def prepare_upload(path: str, size: int, sha256: str, intent: str = "create") -> dict:
    """Prepare an upload of a local HTML file. path includes filename. Pass its size
    in bytes and lowercase SHA-256. Use intent='replace' to replace an existing file.
    Send file bytes to the returned uploadUrl with curl --fail-with-body --upload-file.
    Never pass HTML content to this tool. The response from PUT contains the review URL."""
    return prepare(UploadRequest(path=path, size=size, sha256=sha256, intent=intent), actor_id())


@mcp.tool()
def edit_file(path: str, old_str: str, new_str: str, replace_all: bool = False) -> dict:
    """Replace exact text in an HTML file. old_str must occur exactly once unless
    replace_all=true. Use read_file first and copy the exact text to replace.
    Prefer this over update_file — no need to resend the whole document."""
    if not old_str:
        return {"error": "validation_error", "detail": "old_str must not be empty"}

    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    if not resolved.is_file() or resolved.suffix.lower() != ".html":
        return {"error": "not_found", "detail": f"File {path} not found"}

    artifact = artifact_for_path(path)
    content = object_path(artifact.current_revision_id).read_text(encoding="utf-8", errors="replace")
    count = content.count(old_str)
    if count == 0:
        return {
            "error": "not_found_in_file",
            "detail": "old_str not found — read the file and copy the exact text",
        }
    if count > 1 and not replace_all:
        return {
            "error": "ambiguous",
            "detail": f"old_str occurs {count} times; add surrounding context or set replace_all=true",
        }

    new_content = content.replace(old_str, new_str, -1 if replace_all else 1)
    if len(new_content.encode("utf-8")) > MAX_FILE_SIZE:
        return {"error": "size_exceeded", "detail": "Result exceeds configured size limit"}

    content_bytes = new_content.encode("utf-8")
    staging = UPLOAD_DIR / ".staging"
    staging.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=staging)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content_bytes)
        author = actor_id()
        with transaction() as db:
            result = publish(db, path, temporary, author, artifact.current_revision_id,
                             hashlib.sha256(content_bytes).hexdigest(), len(content_bytes))
        sync_alias(result)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return {"ok": True, "path": path, "replacements": count if replace_all else 1}


@mcp.tool()
def delete_file(path: str, filename: str) -> dict:
    """Delete an HTML file. path is the directory, filename is the file to delete."""
    if not filename or "/" in filename or "\\" in filename:
        raise ValueError("Invalid filename")
    remove(path.rstrip("/") + "/" + filename)
    return {"ok": True, "name": filename, "path": path}


@mcp.tool()
def create_folder(path: str, name: str) -> dict:
    """Create a new folder. path is the parent directory, name is the new folder name."""
    if not name or "/" in name:
        return {"error": "validation_error", "detail": "Invalid folder name"}

    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    folder_path = resolved / name
    if folder_path.exists():
        return {"error": "already_exists", "detail": f"Folder {name} already exists at {path}"}

    folder_path.mkdir(parents=True, exist_ok=True)
    return {"ok": True, "name": name, "path": path}


@mcp.tool()
def delete_folder(path: str) -> dict:
    """Delete a folder and all its contents recursively."""
    remove(path)
    return {"ok": True, "path": path}


@mcp.tool()
def rename(path: str, old_name: str, new_name: str) -> dict:
    """Rename a file or folder. path is the parent directory."""
    if any(not n or "/" in n or "\\" in n for n in (old_name, new_name)):
        raise ValueError("Invalid names")
    relocate(path.rstrip("/") + "/" + old_name, path.rstrip("/") + "/" + new_name)
    return {"ok": True}


@mcp.tool()
def move(from_path: str, name: str, to_path: str) -> dict:
    """Move a file or folder to a different directory."""
    if not name or "/" in name or "\\" in name:
        raise ValueError("Invalid name")
    relocate(from_path.rstrip("/") + "/" + name, to_path.rstrip("/") + "/" + name)
    return {"ok": True}


# ---------------------------------------------------------------------------
# App factory (used by main.py to mount)
# ---------------------------------------------------------------------------

def create_mcp_app():
    """Return the ASGI app for the MCP server, ready to mount at /mcp."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return mcp.http_app(path="/", transport="streamable-http")
