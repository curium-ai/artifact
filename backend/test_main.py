"""Tests for the file-listing API, focused on the not-found behaviour that the
frontend relies on to show a recoverable "folder not found" state."""
import os
import sys
import tempfile

# Point the app at an isolated temp upload dir BEFORE importing main, since main
# reads these at import time.
_TMP = tempfile.mkdtemp(prefix="artifact-test-")
os.environ["ARTIFACT_UPLOAD_DIR"] = _TMP
os.environ["ARTIFACT_MCP_AUTH_DB"] = os.path.join(_TMP, ".auth.db")
os.environ["ARTIFACT_AUTH_MODE"] = "password"

sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

client = TestClient(main.app)


def test_list_missing_folder_returns_404():
    res = client.get("/api/files", params={"path": "/does-not-exist"})
    assert res.status_code == 404


def test_list_existing_folder_returns_listing():
    os.makedirs(os.path.join(_TMP, "docs"), exist_ok=True)
    with open(os.path.join(_TMP, "docs", "a.html"), "w", encoding="utf-8") as f:
        f.write("<h1>hi</h1>")

    res = client.get("/api/files", params={"path": "/docs"})
    assert res.status_code == 200
    body = res.json()
    assert body["folders"] == []
    assert any(item["name"] == "a.html" for item in body["files"])
