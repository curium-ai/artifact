import json
import sqlite3
import time

from database import transaction
from import_legacy import import_legacy
from models import Artifact, OAuthClient, WebSession
from sqlalchemy import select
from stores import SessionStore


def test_legacy_import_read_only_and_rerunnable(tmp_path, upload_dir):
    source = tmp_path / "legacy.db"
    with sqlite3.connect(source) as db:
        db.executescript(
            "CREATE TABLE web_sessions(token TEXT PRIMARY KEY, email TEXT, expires_at REAL);"
            "CREATE TABLE mcp_clients(client_id TEXT PRIMARY KEY, data TEXT);"
        )
        db.execute(
            "INSERT INTO web_sessions VALUES (?, ?, ?)", ("legacy-token", "alice@example.test", time.time() + 3600)
        )
        db.execute(
            "INSERT INTO mcp_clients VALUES (?, ?)",
            (
                "legacy-client",
                json.dumps(
                    {
                        "client_id": "legacy-client",
                        "redirect_uris": ["http://localhost:1234/callback"],
                        "token_endpoint_auth_method": "none",
                    }
                ),
            ),
        )
    original = source.read_bytes()
    (upload_dir / "legacy.html").write_text("<h1>Legacy file</h1>")
    assert import_legacy(source)["files"] == 1
    with transaction() as db:
        assert not db.scalars(select(Artifact)).all()
        assert not db.scalars(select(WebSession)).all()
    first = import_legacy(source, apply=True)
    second = import_legacy(source, apply=True)
    assert first == second
    assert source.read_bytes() == original
    assert SessionStore().get("legacy-token")["email"] == "alice@example.test"
    with transaction() as db:
        assert len(db.scalars(select(Artifact)).all()) == 1
        assert len(db.scalars(select(WebSession)).all()) == 1
        assert db.get(OAuthClient, "legacy-client") is not None


def test_migration_has_one_head():
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(Path(__file__).parent.parent / "alembic.ini"))
    assert len(ScriptDirectory.from_config(config).get_heads()) == 1
