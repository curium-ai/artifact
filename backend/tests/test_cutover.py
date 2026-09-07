import json
import sqlite3
import time

import pytest
from cutover_legacy import cutover
from database import transaction
from models import Artifact
from sqlalchemy import select


def test_cutover_backs_up_imports_and_retries(upload_dir, monkeypatch):
    monkeypatch.setenv("ARTIFACT_MCP_AUTH_DB", str(upload_dir / ".legacy.db"))
    with sqlite3.connect(upload_dir / ".legacy.db") as old:
        old.executescript(
            "CREATE TABLE web_sessions(token TEXT,email TEXT,expires_at REAL);"
            "CREATE TABLE mcp_clients(client_id TEXT,data TEXT);"
            "CREATE TABLE mcp_access_tokens(token TEXT,data TEXT,expires_at REAL);"
            "CREATE TABLE mcp_refresh_tokens(token TEXT,data TEXT,email TEXT);"
        )
        old.execute("INSERT INTO web_sessions VALUES(?,?,?)", ("legacy-session", "qa@example.test", time.time() + 3600))
    (upload_dir / "example.html").write_text("<section>Original</section>")
    cutover()
    marker = upload_dir / ".cutover-backups" / "postgres-completed.json"
    assert json.loads(marker.read_text())["verified_all_file_hashes"] is True
    cutover()
    with transaction() as db:
        assert len(db.scalars(select(Artifact)).all()) == 1
    data = json.loads(marker.read_text())
    data["database_identity"] = "another database"
    marker.write_text(json.dumps(data))
    with pytest.raises(RuntimeError, match="different database"):
        cutover()
