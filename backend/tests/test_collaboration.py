import errno
import hashlib
import time

import pytest
from artifacts import object_path
from database import transaction
from models import Artifact, Comment, Notification, Revision, UploadGrant
from sqlalchemy import select
from stores import SessionStore, digest
from uploads import UploadRequest, prepare


def user(client, email="author@example.test"):
    token = "test-session-" + email
    SessionStore().save(token, email, time.time() + 3600)
    client.cookies.set("artifact_session", token)
    return SessionStore().get(token)["user_id"]


def upload(client, author, content=b'<section id="summary">Summary</section>', path="/report.html", intent="create"):
    grant = prepare(
        UploadRequest(path=path, size=len(content), sha256=hashlib.sha256(content).hexdigest(), intent=intent), author
    )
    response = client.put(grant["uploadUrl"], content=content)
    assert response.status_code == 200, response.text
    return response.json(), grant


def anchor():
    return {"selector": "#summary", "elementId": "summary", "stableId": "", "tag": "section", "text": "Summary"}


def thread(client, result, body="Please revise this section"):
    response = client.post(
        f"/api/artifacts/{result['artifactId']}/threads",
        json={"revisionId": result["revisionId"], "anchor": anchor(), "body": body},
    )
    assert response.status_code == 201, response.text
    return response.json()["threadId"]


def test_large_upload_and_idempotent_retry(client, upload_dir):
    author = user(client)
    content = b"<html>" + b"x" * (11 * 1024 * 1024) + b"</html>"
    result, grant = upload(client, author, content)
    assert client.put(grant["uploadUrl"], content=content).json() == result
    assert client.get("/raw/report.html").content == content
    assert object_path(result["revisionId"]).read_bytes() == content
    with transaction() as db:
        assert len(db.scalars(select(Revision)).all()) == 1
    assert not list((upload_dir / ".staging").iterdir())


def test_size_limit_matches_configuration(client):
    assert client.get("/api/auth/status").json()["maxFileBytes"] == 104857600
    author = user(client)
    with pytest.raises(ValueError):
        prepare(UploadRequest(path="/x.html", size=104857601, sha256="a" * 64), author)
    grant = prepare(UploadRequest(path="/x.html", size=104857600, sha256="a" * 64), author)
    assert grant["maxFileBytes"] == 104857600


def test_checksum_and_short_body_never_publish(client, upload_dir):
    author = user(client)
    grant = prepare(UploadRequest(path="/bad.html", size=5, sha256=hashlib.sha256(b"12345").hexdigest()), author)
    assert client.put(grant["uploadUrl"], content=b"wrong").status_code == 422
    assert client.put(grant["uploadUrl"], content=b"1").status_code == 422
    assert not (upload_dir / "bad.html").exists()
    assert not list((upload_dir / ".staging").iterdir())
    assert client.put(grant["uploadUrl"], content=b"12345").status_code == 200


def test_stale_replacement_cannot_overwrite(client):
    author = user(client)
    original, _ = upload(client, author)
    body = b"<h1>changed</h1>"
    request = UploadRequest(
        path="/report.html", size=len(body), sha256=hashlib.sha256(body).hexdigest(), intent="replace"
    )
    first, second = prepare(request, author), prepare(request, author)
    changed = client.put(first["uploadUrl"], content=body)
    assert changed.status_code == 200
    assert client.put(second["uploadUrl"], content=body).status_code == 409
    assert changed.json()["artifactId"] == original["artifactId"]
    assert object_path(original["revisionId"]).exists()


def test_expired_grant_and_traversal(client):
    author = user(client)
    data = UploadRequest(path="/report.html", size=1, sha256=hashlib.sha256(b"x").hexdigest())
    grant = prepare(data, author)
    with transaction() as db:
        row = db.get(UploadGrant, digest(grant["uploadUrl"].split("/")[-1]))
        row.expires_at = 0
    assert client.put(grant["uploadUrl"], content=b"x").status_code == 410
    for path in ["/../escape.html", "/.objects/secret.html", "/folder/../escape.html"]:
        with pytest.raises(Exception) as failure:
            prepare(data.model_copy(update={"path": path}), author)
        assert failure.value.status_code == 400


def test_disk_full_keeps_existing_revision(client, monkeypatch, upload_dir):
    import uploads

    author = user(client)
    original, _ = upload(client, author)
    body = b"<h1>new</h1>"
    grant = prepare(
        UploadRequest(path="/report.html", size=len(body), sha256=hashlib.sha256(body).hexdigest(), intent="replace"),
        author,
    )

    def fail(*args, **kwargs):
        raise OSError(errno.ENOSPC, "No space")

    monkeypatch.setattr(uploads, "publish", fail)
    assert client.put(grant["uploadUrl"], content=body).status_code == 507
    with transaction() as db:
        assert db.get(Artifact, original["artifactId"]).current_revision_id == original["revisionId"]
    assert not list((upload_dir / ".staging").iterdir())


def test_comments_notifications_and_replacement(client):
    author = user(client)
    result, _ = upload(client, author)
    reviewer = user(client, "reviewer@example.test")
    thread_id = thread(client, result)
    assert client.get("/api/notifications").json() == []
    user(client)
    notifications = client.get("/api/notifications").json()
    assert len(notifications) == 1
    assert notifications[0]["threadId"] == thread_id
    assert not notifications[0]["read"]
    assert client.post(f"/api/notifications/{notifications[0]['id']}/read").status_code == 200
    assert client.post(f"/api/threads/{thread_id}/replies", json={"body": "Updated"}).status_code == 201
    assert client.patch(f"/api/threads/{thread_id}", json={"resolved": True}).status_code == 200
    assert client.post(f"/api/threads/{thread_id}/replies", json={"body": "Another"}).status_code == 409
    assert client.patch(f"/api/threads/{thread_id}", json={"resolved": False}).status_code == 200
    updated, _ = upload(client, author, b'<section id="summary">Revised</section>', intent="replace")
    assert (
        client.post(
            f"/api/artifacts/{result['artifactId']}/threads",
            json={"revisionId": result["revisionId"], "anchor": anchor(), "body": "stale"},
        ).status_code
        == 409
    )
    rows = client.get(f"/api/artifacts/{result['artifactId']}/threads").json()
    assert rows[0]["revisionId"] == result["revisionId"]
    assert rows[0]["authorId"] == reviewer
    assert (
        client.patch(
            f"/api/threads/{thread_id}",
            json={"revisionId": updated["revisionId"], "anchor": {**anchor(), "text": "Revised"}},
        ).status_code
        == 200
    )
    user(client, "reviewer@example.test")
    assert len(client.get("/api/notifications").json()) == 1
    assert client.post(f"/api/notifications/{notifications[0]['id']}/read").status_code == 404


def test_permissions_and_comment_transaction(client):
    author = user(client)
    result, _ = upload(client, author)
    tid = thread(client, result)
    user(client, "other@example.test")
    assert client.patch(f"/api/threads/{tid}", json={"resolved": True}).status_code == 403
    assert client.post(f"/api/threads/{tid}/replies", json={"body": "  "}).status_code == 422
    with transaction() as db:
        assert len(db.scalars(select(Comment)).all()) == 1
        assert not db.scalars(select(Notification)).all()
    client.cookies.clear()
    assert client.get(f"/api/artifacts/{result['artifactId']}/threads").status_code == 401
    assert client.get(f"/api/artifacts/{result['artifactId']}/review/{result['revisionId']}").status_code == 401


def test_move_preserves_threads_and_review_identity(client):
    author = user(client)
    result, _ = upload(client, author)
    tid = thread(client, result)
    assert (
        client.post(
            "/api/files/rename", json={"path": "/", "oldName": "report.html", "newName": "renamed.html"}
        ).status_code
        == 200
    )
    assert client.get(f"/api/artifacts/{result['artifactId']}").json()["path"] == "/renamed.html"
    assert client.get(f"/api/artifacts/{result['artifactId']}/threads").json()[0]["id"] == tid
    assert client.get("/raw/report.html").status_code == 404
    assert client.get("/raw/renamed.html").status_code == 200


def test_review_keeps_source_and_sandbox(client):
    result, _ = upload(client, user(client))
    response = client.get(f"/api/artifacts/{result['artifactId']}/review/{result['revisionId']}")
    assert response.status_code == 200
    assert response.headers["content-security-policy"] == "sandbox allow-scripts"
    assert "artifact-review" in response.text
    assert "artifact-review" not in client.get("/raw/report.html").text


def test_browser_rejects_oversize_during_parsing(client, monkeypatch, upload_dir):
    import uploads

    user(client)
    monkeypatch.setattr(uploads, "MAX_FILE_BYTES", 10)
    response = client.post("/api/files/upload", files={"files": ("large.html", b"x" * 11, "text/html")})
    assert response.status_code == 413
    assert not (upload_dir / "large.html").exists()


def test_duplicate_parallel_upload_creates_one_revision(client):
    from concurrent.futures import ThreadPoolExecutor

    from database import engine

    if engine.dialect.name != "postgresql":
        pytest.skip("Row-lock concurrency is exercised against PostgreSQL")
    author = user(client)
    content = b"<h1>Concurrent</h1>"
    grant = prepare(
        UploadRequest(path="/parallel.html", size=len(content), sha256=hashlib.sha256(content).hexdigest()), author
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.put(grant["uploadUrl"], content=content), range(2)))
    assert [r.status_code for r in results] == [200, 200]
    assert results[0].json() == results[1].json()
    with transaction() as db:
        assert len(db.scalars(select(Revision)).all()) == 1


def test_exact_100_mib_upload(client):
    author = user(client)
    chunk = b"x" * (1024 * 1024)
    checksum = hashlib.sha256()
    for _ in range(100):
        checksum.update(chunk)
    grant = prepare(UploadRequest(path="/heavy.html", size=104857600, sha256=checksum.hexdigest()), author)
    response = client.put(grant["uploadUrl"], content=(chunk for _ in range(100)))
    assert response.status_code == 200
    assert response.json()["bytes"] == 104857600
    assert object_path(response.json()["revisionId"]).stat().st_size == 104857600


def test_interrupted_upload_discards_staging(client, upload_dir):
    import asyncio

    from starlette.requests import ClientDisconnect, Request
    from uploads import upload as receive_upload

    author = user(client)
    grant = prepare(
        UploadRequest(path="/interrupted.html", size=6, sha256=hashlib.sha256(b"abcdef").hexdigest()), author
    )
    calls = 0

    async def receive():
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"type": "http.request", "body": b"abc", "more_body": True}
        return {"type": "http.disconnect"}

    request = Request({"type": "http", "method": "PUT", "path": "/", "headers": []}, receive)
    with pytest.raises(ClientDisconnect):
        asyncio.run(receive_upload(grant["uploadUrl"].split("/")[-1], request))
    assert not (upload_dir / "interrupted.html").exists()
    assert not list((upload_dir / ".staging").iterdir())
    assert client.put(grant["uploadUrl"], content=b"abcdef").status_code == 200


def test_shared_link_opens_review_and_preserves_encoded_path_through_login(client, monkeypatch):
    from urllib.parse import quote

    import main

    author = user(client)
    path = '/folder with spaces/report #1 & notes.html'
    result, _ = upload(client, author, path=path)
    shared = '/v' + quote(path, safe='/')
    response = client.get(shared, follow_redirects=False)
    assert response.status_code == 302
    assert response.headers['location'] == '/a/' + result['artifactId']
    assert response.headers['cache-control'] == 'no-store'
    assert client.get(response.headers['location'], follow_redirects=False).headers['location'] == '/browse?artifact=' + result['artifactId']

    client.cookies.clear()
    monkeypatch.setattr(main, 'AUTH_MODE', 'google')
    response = client.get(shared, follow_redirects=False)
    assert response.status_code == 302
    assert response.headers['location'] == '/browse/folder%20with%20spaces?f=report%20%231%20%26%20notes.html'
    assert client.get('/api/artifact', params={'path': path}).status_code == 401
    user(client)
    assert client.get('/api/artifact', params={'path': path}).json()['id'] == result['artifactId']


def test_signed_out_shared_link_does_not_disclose_existence(client, monkeypatch):
    import main

    monkeypatch.setattr(main, 'AUTH_MODE', 'google')
    response = client.get('/v/not-created.html', follow_redirects=False)
    assert response.status_code == 302
    assert response.headers['location'] == '/browse?f=not-created.html'
    response = client.get('/raw/not-created.html', follow_redirects=False)
    assert response.headers['location'] == '/browse?f=not-created.html'


def test_shared_link_rejects_traversal(client):
    assert client.get('/v/%2E%2E/secret.html', follow_redirects=False).status_code == 400
