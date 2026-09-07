import os
import shutil
import sys
import tempfile
from pathlib import Path

# main.py / mcp_server.py read these at import time — set before importing.
_upload_dir = tempfile.mkdtemp(prefix="artifact-test-uploads-")
_frontend_dir = tempfile.mkdtemp(prefix="artifact-test-frontend-")
Path(_frontend_dir, "index.html").write_text("<html>SPA</html>")
# A secret file OUTSIDE the frontend dir, target for traversal tests.
Path(_frontend_dir).parent.joinpath("artifact-test-secret.txt").write_text("secret-marker")

os.environ["ARTIFACT_UPLOAD_DIR"] = _upload_dir
os.environ["ARTIFACT_FRONTEND_DIR"] = _frontend_dir
os.environ["ARTIFACT_PASSWORD"] = "test-password"
os.environ["ARTIFACT_MCP_TOKEN"] = "test-mcp-token"
os.environ["ARTIFACT_AUTH_MODE"] = "password"
# Keep the SQLite session/token db out of the upload dir so listing
# assertions see only test files.
os.environ["ARTIFACT_MCP_AUTH_DB"] = os.path.join(tempfile.mkdtemp(prefix="artifact-test-db-"), "auth.db")

os.environ["DATABASE_URL"] = os.environ.get("ARTIFACT_TEST_DATABASE_URL", "sqlite:///" + str(Path(tempfile.mkdtemp(prefix="artifact-test-sqlite-")) / "test.db"))
os.environ["ARTIFACT_PUBLIC_URL"] = "http://testserver"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from alembic import command
from alembic.config import Config
from database import engine
from fastapi.testclient import TestClient
from models import Base
from sqlalchemy import delete

command.upgrade(Config(str(Path(__file__).parent.parent / "alembic.ini")), "head")
import main


@pytest.fixture(autouse=True)
def upload_dir():
    d = Path(_upload_dir)
    d.mkdir(parents=True, exist_ok=True)
    yield d
    for item in d.iterdir():
        shutil.rmtree(item) if item.is_dir() else item.unlink()
    with engine.begin() as db:
        for table in reversed(Base.metadata.sorted_tables):
            db.execute(delete(table))


@pytest.fixture()
def client():
    with TestClient(main.app) as c:
        yield c


@pytest.fixture()
def auth_client(client):
    res = client.post("/api/auth/login", json={"password": "test-password"})
    assert res.status_code == 200
    return client
