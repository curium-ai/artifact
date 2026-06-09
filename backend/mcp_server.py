import os
import shutil
import time
from pathlib import Path, PurePosixPath
from urllib.parse import urlencode

from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse

from mcp_auth import ArtifactOAuthProvider

UPLOAD_DIR = Path(
    os.environ.get(
        "ARTIFACT_UPLOAD_DIR",
        os.path.join(os.path.dirname(__file__), "uploads"),
    )
)
MAX_FILE_SIZE = 10 * 1024 * 1024

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
ALLOWED_DOMAIN = os.environ.get("ARTIFACT_ALLOWED_DOMAIN", "")
MCP_BASE_URL = os.environ.get("ARTIFACT_MCP_BASE_URL", "http://localhost:8000/mcp")


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
        "Only .html files are supported, max 10 MB each. "
        "Paths use forward slashes and start from root /."
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
            f"<h1>Authentication failed</h1><p>{error}</p>", status_code=403
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
            f"<h1>Access denied</h1><p>{e}</p>", status_code=403
        )
    except Exception as e:
        return HTMLResponse(
            f"<h1>Authentication error</h1><p>{e}</p>", status_code=400
        )

    params = {"code": mcp_code}
    if mcp_state:
        params["state"] = mcp_state
    separator = "&" if "?" in redirect_uri else "?"
    return RedirectResponse(
        url=f"{redirect_uri}{separator}{urlencode(params)}",
        status_code=302,
    )


# ---------------------------------------------------------------------------
# Path helpers (mirrors backend/main.py resolve_path)
# ---------------------------------------------------------------------------

def _resolve(user_path: str) -> Path:
    cleaned = PurePosixPath("/" + user_path.strip("/"))
    resolved = (UPLOAD_DIR / cleaned.relative_to("/")).resolve()
    if not str(resolved).startswith(str(UPLOAD_DIR.resolve())):
        raise ValueError("Invalid path")
    return resolved


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


@mcp.tool()
def read_file(path: str) -> dict:
    """Read an HTML file's content. path should be like /folder/file.html"""
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
        "content": resolved.read_text(encoding="utf-8", errors="replace"),
        "size": _format_size(stat.st_size),
        "modified": _format_time_ago(stat.st_mtime),
        "bytes": stat.st_size,
    }


@mcp.tool()
def create_file(path: str, filename: str, content: str) -> dict:
    """Create a new HTML file. path is the directory, filename must end in .html."""
    if not filename.endswith(".html"):
        return {"error": "validation_error", "detail": "Filename must end in .html"}
    if "/" in filename:
        return {"error": "validation_error", "detail": "Filename must not contain /"}
    if len(content.encode("utf-8")) > MAX_FILE_SIZE:
        return {"error": "size_exceeded", "detail": "Content exceeds 10 MB limit"}

    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    resolved.mkdir(parents=True, exist_ok=True)
    file_path = resolved / filename
    if file_path.exists():
        return {"error": "already_exists", "detail": f"{filename} already exists at {path}"}

    file_path.write_text(content, encoding="utf-8")
    stat = file_path.stat()
    return {"ok": True, "name": filename, "path": path, "size": _format_size(stat.st_size), "bytes": stat.st_size}


@mcp.tool()
def update_file(path: str, content: str) -> dict:
    """Overwrite an existing HTML file. path should be like /folder/file.html"""
    if len(content.encode("utf-8")) > MAX_FILE_SIZE:
        return {"error": "size_exceeded", "detail": "Content exceeds 10 MB limit"}

    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    if not resolved.exists() or not resolved.is_file():
        return {"error": "not_found", "detail": f"File {path} not found"}
    if resolved.suffix.lower() != ".html":
        return {"error": "validation_error", "detail": "Only .html files can be updated"}

    resolved.write_text(content, encoding="utf-8")
    stat = resolved.stat()
    return {"ok": True, "name": resolved.name, "path": path, "size": _format_size(stat.st_size), "bytes": stat.st_size}


@mcp.tool()
def delete_file(path: str, filename: str) -> dict:
    """Delete an HTML file. path is the directory, filename is the file to delete."""
    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    target = resolved / filename
    if not target.exists() or not target.is_file():
        return {"error": "not_found", "detail": f"File {filename} not found at {path}"}

    target.unlink()
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
    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    if not resolved.exists() or not resolved.is_dir():
        return {"error": "not_found", "detail": f"Folder {path} not found"}
    if resolved == UPLOAD_DIR.resolve():
        return {"error": "validation_error", "detail": "Cannot delete the root upload directory"}

    shutil.rmtree(resolved)
    return {"ok": True, "path": path}


@mcp.tool()
def rename(path: str, old_name: str, new_name: str) -> dict:
    """Rename a file or folder. path is the parent directory."""
    if not old_name or not new_name or "/" in new_name:
        return {"error": "validation_error", "detail": "Invalid names"}

    try:
        resolved = _resolve(path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    old_path = resolved / old_name
    new_path = resolved / new_name
    if not old_path.exists():
        return {"error": "not_found", "detail": f"{old_name} not found at {path}"}
    if new_path.exists():
        return {"error": "already_exists", "detail": f"{new_name} already exists at {path}"}

    old_path.rename(new_path)
    return {"ok": True, "old_name": old_name, "new_name": new_name, "path": path}


@mcp.tool()
def move(from_path: str, name: str, to_path: str) -> dict:
    """Move a file or folder to a different directory."""
    if not name:
        return {"error": "validation_error", "detail": "No item specified"}

    try:
        source_dir = _resolve(from_path)
        dest_dir = _resolve(to_path)
    except ValueError:
        return {"error": "invalid_path", "detail": "Path must not escape the upload directory"}

    source = source_dir / name
    dest = dest_dir / name
    if not source.exists():
        return {"error": "not_found", "detail": f"{name} not found at {from_path}"}
    if dest.exists():
        return {"error": "already_exists", "detail": f"{name} already exists at {to_path}"}

    dest_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(dest))
    return {"ok": True, "name": name, "from_path": from_path, "to_path": to_path}


# ---------------------------------------------------------------------------
# App factory (used by main.py to mount)
# ---------------------------------------------------------------------------

def create_mcp_app():
    """Return the ASGI app for the MCP server, ready to mount at /mcp."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return mcp.http_app(path="/", transport="streamable-http")
