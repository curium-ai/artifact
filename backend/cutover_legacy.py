"""One-time, fail-closed production cutover; run before accepting HTTP traffic."""

import hashlib
import json
import os
import sqlite3
import tarfile
import time
from pathlib import Path


def cutover():
    from artifacts import object_path
    from database import transaction, url
    from import_legacy import import_legacy
    from models import Artifact, OAuthAccess, OAuthClient, OAuthRefresh, Revision, User, WebSession
    from sqlalchemy import func, select
    from stores import SessionStore, digest

    root = Path(os.environ.get("ARTIFACT_UPLOAD_DIR", "/data")).resolve()
    backups = root / ".cutover-backups"
    marker = backups / "postgres-completed.json"
    identity = hashlib.sha256(url.render_as_string(hide_password=True).encode()).hexdigest()
    if marker.exists():
        if json.loads(marker.read_text()).get("database_identity") != identity:
            raise RuntimeError("Cutover marker belongs to a different database; verify the restore before proceeding")
        print("ARTIFACT_CUTOVER already completed; starting application", flush=True)
        return
    backups.mkdir(exist_ok=True, mode=0o700)
    os.chmod(backups, 0o700)
    backup = backups / ("postgres-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()))
    backup.mkdir(mode=0o700)
    source = Path(os.environ.get("ARTIFACT_MCP_AUTH_DB", str(root / ".mcp_auth.db")))
    with (
        sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True) as old,
        sqlite3.connect(backup / "auth.db") as new,
    ):
        old.backup(new)
        assert new.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    os.chmod(backup / "auth.db", 0o600)
    manifest = {}
    for path in root.rglob("*.html"):
        if any(part.startswith(".") for part in path.relative_to(root).parts):
            continue
        with path.open("rb") as stream:
            checksum = hashlib.file_digest(stream, "sha256").hexdigest()
        manifest["/" + path.relative_to(root).as_posix()] = {"size": path.stat().st_size, "sha256": checksum}
    with tarfile.open(backup / "files.tar.gz", "w:gz") as archive:
        for path in root.iterdir():
            if not path.name.startswith("."):
                archive.add(path, arcname=path.name)
    os.chmod(backup / "files.tar.gz", 0o600)
    # Verify the backup itself before importing anything.
    with tarfile.open(backup / "files.tar.gz", "r:gz") as archive:
        for path, expected in manifest.items():
            with archive.extractfile(path.lstrip("/")) as stream:
                assert hashlib.file_digest(stream, "sha256").hexdigest() == expected["sha256"]
    (backup / "manifest.json").write_text(json.dumps(manifest))
    print(
        "ARTIFACT_CUTOVER backup verified "
        + json.dumps(
            {"backup": str(backup), "files": len(manifest), "html_bytes": sum(x["size"] for x in manifest.values())}
        ),
        flush=True,
    )
    print("ARTIFACT_CUTOVER imported " + json.dumps(import_legacy(backup / "auth.db", apply=True)), flush=True)
    with transaction() as db:
        artifacts = db.scalars(select(Artifact).where(Artifact.deleted.is_(False))).all()
        assert len(artifacts) == len(manifest), (len(artifacts), len(manifest))
        for artifact in artifacts:
            revision = db.get(Revision, artifact.current_revision_id)
            expected = manifest[artifact.path]
            assert revision.sha256 == expected["sha256"] and revision.size == expected["size"]
            with object_path(revision.id).open("rb") as stream:
                assert hashlib.file_digest(stream, "sha256").hexdigest() == expected["sha256"]
        counts = {
            model.__tablename__: db.scalar(select(func.count()).select_from(model))
            for model in [Artifact, Revision, User, WebSession, OAuthClient, OAuthAccess, OAuthRefresh]
        }
        with sqlite3.connect(backup / "auth.db") as old:
            for token, expires in old.execute("select token,expires_at from web_sessions"):
                if expires > time.time():
                    assert SessionStore().get(token) is not None
            for (client_id,) in old.execute("select client_id from mcp_clients"):
                assert db.get(OAuthClient, client_id) is not None
            for (token,) in old.execute("select token from mcp_refresh_tokens"):
                assert db.get(OAuthRefresh, digest(token)) is not None
    result = {
        "database_identity": identity,
        "backup": str(backup),
        "verified_all_file_hashes": True,
        "legacy_sessions_and_clients_preserved": True,
        "counts": counts,
    }
    temporary = backups / "postgres-completed.tmp"
    temporary.write_text(json.dumps(result))
    temporary.replace(marker)
    print("ARTIFACT_CUTOVER verified " + json.dumps(result), flush=True)


if __name__ == "__main__":
    cutover()
    os.execvp("uvicorn", ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", os.environ.get("PORT", "8000")])
