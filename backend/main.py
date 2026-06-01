import os
import shutil
import secrets
import time
from pathlib import Path, PurePosixPath
from typing import Optional

from fastapi import FastAPI, HTTPException, Cookie, Response, Request, Query
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Artifact")

UPLOAD_DIR = Path(os.environ.get("ARTIFACT_UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "uploads")))
PASSWORD = os.environ.get("ARTIFACT_PASSWORD", "artifact")
MAX_FILE_SIZE = 10 * 1024 * 1024
FRONTEND_DIR = Path(os.environ.get("ARTIFACT_FRONTEND_DIR", os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")))

active_sessions: dict[str, float] = {}
SESSION_TTL = 86400

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def resolve_path(user_path: str) -> Path:
    cleaned = PurePosixPath("/" + user_path.strip("/"))
    resolved = (UPLOAD_DIR / cleaned.relative_to("/")).resolve()
    if not str(resolved).startswith(str(UPLOAD_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    return resolved


def is_authenticated(session_token: Optional[str]) -> bool:
    if not session_token:
        return False
    expiry = active_sessions.get(session_token)
    if not expiry or time.time() > expiry:
        active_sessions.pop(session_token, None)
        return False
    return True


def require_auth(session_token: Optional[str]):
    if not is_authenticated(session_token):
        raise HTTPException(status_code=401, detail="Authentication required")


@app.on_event("startup")
def startup():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@app.post("/api/auth/login")
async def login(request: Request, response: Response):
    body = await request.json()
    password = body.get("password", "")
    if password != PASSWORD:
        raise HTTPException(status_code=401, detail="Incorrect password")
    token = secrets.token_urlsafe(32)
    active_sessions[token] = time.time() + SESSION_TTL
    response.set_cookie(
        key="artifact_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=SESSION_TTL,
    )
    return {"ok": True}


@app.post("/api/auth/logout")
def logout(response: Response, artifact_session: Optional[str] = Cookie(None)):
    if artifact_session:
        active_sessions.pop(artifact_session, None)
    response.delete_cookie("artifact_session")
    return {"ok": True}


@app.get("/api/auth/status")
def auth_status(artifact_session: Optional[str] = Cookie(None)):
    return {"authenticated": is_authenticated(artifact_session)}


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
def list_files(path: str = "/"):
    resolved = resolve_path(path)
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
def get_tree():
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
    artifact_session: Optional[str] = Cookie(None),
):
    require_auth(artifact_session)
    resolved = resolve_path(path)
    resolved.mkdir(parents=True, exist_ok=True)

    form = await request.form()
    uploaded = []
    for key in form:
        upload = form[key]
        if not hasattr(upload, "filename") or not upload.filename:
            continue
        if not upload.filename.endswith(".html"):
            continue
        content = await upload.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail=f"File {upload.filename} exceeds 10MB limit")
        file_path = resolved / upload.filename
        file_path.write_bytes(content)
        uploaded.append(upload.filename)

    return {"uploaded": uploaded, "count": len(uploaded)}


@app.post("/api/folders")
async def create_folder(
    request: Request,
    artifact_session: Optional[str] = Cookie(None),
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
    artifact_session: Optional[str] = Cookie(None),
):
    require_auth(artifact_session)
    body = await request.json()
    path = body.get("path", "/")
    old_name = body.get("oldName", "")
    new_name = body.get("newName", "").strip()
    if not old_name or not new_name or "/" in new_name:
        raise HTTPException(status_code=400, detail="Invalid names")
    resolved = resolve_path(path)
    old_path = resolved / old_name
    new_path = resolved / new_name
    if not old_path.exists():
        raise HTTPException(status_code=404, detail="Item not found")
    if new_path.exists():
        raise HTTPException(status_code=409, detail="Name already taken")
    old_path.rename(new_path)
    return {"ok": True}


@app.post("/api/files/move")
async def move_item(
    request: Request,
    artifact_session: Optional[str] = Cookie(None),
):
    require_auth(artifact_session)
    body = await request.json()
    from_path = body.get("fromPath", "/")
    name = body.get("name", "")
    to_path = body.get("toPath", "/")
    if not name:
        raise HTTPException(status_code=400, detail="No item specified")
    source = resolve_path(from_path) / name
    dest_dir = resolve_path(to_path)
    dest = dest_dir / name
    if not source.exists():
        raise HTTPException(status_code=404, detail="Item not found")
    if dest.exists():
        raise HTTPException(status_code=409, detail="Item already exists at destination")
    dest_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(dest))
    return {"ok": True}


@app.delete("/api/files")
async def delete_item(
    request: Request,
    artifact_session: Optional[str] = Cookie(None),
):
    require_auth(artifact_session)
    body = await request.json()
    path = body.get("path", "/")
    name = body.get("name", "")
    item_type = body.get("type", "file")
    resolved = resolve_path(path)
    target = resolved / name
    if not target.exists():
        raise HTTPException(status_code=404, detail="Item not found")
    if item_type == "folder" and target.is_dir():
        shutil.rmtree(target)
    elif target.is_file():
        target.unlink()
    else:
        raise HTTPException(status_code=400, detail="Type mismatch")
    return {"ok": True}


@app.get("/v/{file_path:path}")
def serve_public(file_path: str):
    resolved = resolve_path(file_path)
    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if resolved.suffix.lower() != ".html":
        raise HTTPException(status_code=404, detail="File not found")
    return HTMLResponse(content=resolved.read_text(encoding="utf-8", errors="replace"))


# Serve frontend static files in production
if FRONTEND_DIR.exists() and FRONTEND_DIR.is_dir():
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        file_path = FRONTEND_DIR / full_path
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
