import hashlib
import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote

from database import lock_writes, transaction
from fastapi import HTTPException
from models import Artifact, Revision, new_id
from settings import PUBLIC_URL, UPLOAD_DIR
from sqlalchemy import select


def resolve(path):
    parts = path.strip("/").split("/")
    if any(p.startswith(".") or "\\" in p or "\x00" in p for p in parts):
        raise HTTPException(400, "Invalid path")
    base = os.path.realpath(UPLOAD_DIR)
    candidate = os.path.realpath(os.path.join(base, path.strip("/")))
    if candidate != base and not candidate.startswith(base + os.sep):
        raise HTTPException(400, "Invalid path")
    return Path(candidate)


def canonical(path):
    relative = resolve(path).relative_to(UPLOAD_DIR).as_posix()
    return "/" if relative == "." else "/" + relative


def object_path(revision_id):
    return UPLOAD_DIR / ".objects" / f"{revision_id}.html"


def hash_file(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def ensure_artifact(db, path):
    path = canonical(path)
    artifact = db.scalar(select(Artifact).where(Artifact.path == path, Artifact.deleted.is_(False)))
    if artifact:
        return artifact
    file = resolve(path)
    if not file.is_file() or file.suffix != ".html":
        return None
    if artifact is None:
        artifact = db.scalar(select(Artifact).where(Artifact.path == path))
    if artifact:
        return None
    artifact = Artifact(path=path)
    db.add(artifact)
    db.flush()
    rev = Revision(id=new_id(), artifact_id=artifact.id, sha256=hash_file(file), size=file.stat().st_size)
    target = object_path(rev.id)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(file, target)
    db.add(rev)
    artifact.current_revision_id = rev.id
    db.flush()
    return artifact


def artifact_for_path(path):
    with transaction() as db:
        existing = db.scalar(select(Artifact).where(Artifact.path == canonical(path), Artifact.deleted.is_(False)))
        if existing:
            return existing
    with transaction() as db:
        lock_writes(db)
        artifact = ensure_artifact(db, path)
        if not artifact:
            raise HTTPException(404, "File not found")
        return artifact


def result_for(artifact, revision):
    return {
        "artifactId": artifact.id,
        "revisionId": revision.id,
        "path": artifact.path,
        "bytes": revision.size,
        "sha256": revision.sha256,
        "reviewUrl": f"{PUBLIC_URL}/a/{artifact.id}",
        "url": f"{PUBLIC_URL}/v{quote(artifact.path, safe='/')}",
    }


def publish(db, path, temporary, author_id, expected_revision_id, sha256, size):
    lock_writes(db)
    artifact = ensure_artifact(db, path)
    current = artifact.current_revision_id if artifact else None
    if current != expected_revision_id:
        raise HTTPException(409, "File changed since upload was prepared; prepare a new upload")
    if artifact is None:
        path = canonical(path)
        old = db.scalar(select(Artifact).where(Artifact.path == path))
        if old:
            old.path = f"/.deleted/{old.id}"
            db.flush()
        artifact = Artifact(path=path, owner_id=author_id)
        db.add(artifact)
        db.flush()
    rev = Revision(id=new_id(), artifact_id=artifact.id, author_id=author_id, sha256=sha256, size=size)
    target = object_path(rev.id)
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(temporary, target)
    db.add(rev)
    artifact.current_revision_id = rev.id
    if artifact.owner_id is None:
        artifact.owner_id = author_id
    db.flush()
    return result_for(artifact, rev)


def sync_alias(result):
    # Retries repair the alias using the current revision, never an older grant.
    with transaction() as db:
        lock_writes(db)
        artifact = db.get(Artifact, result["artifactId"])
        if not artifact or artifact.deleted:
            return
        destination = resolve(artifact.path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".publish-", dir=destination.parent)
        os.close(fd)
        try:
            shutil.copyfile(object_path(artifact.current_revision_id), temporary)
            os.replace(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)


def relocate(source_path, destination_path):
    source, destination = resolve(source_path), resolve(destination_path)
    with transaction() as db:
        lock_writes(db)
        if not source.exists():
            raise HTTPException(404, "Item not found")
        if destination.exists() or source == UPLOAD_DIR or source in destination.parents:
            raise HTTPException(409, "Invalid destination or destination already exists")
        if source.is_file():
            ensure_artifact(db, canonical(source_path))
        else:
            for file in source.rglob("*.html"):
                if not any(p.startswith(".") for p in file.relative_to(source).parts):
                    ensure_artifact(db, "/" + file.relative_to(UPLOAD_DIR).as_posix())
        old, new = canonical(source_path), canonical(destination_path)
        rows = db.scalars(select(Artifact).where(Artifact.deleted.is_(False))).all()
        for row in rows:
            if row.path == old or row.path.startswith(old + "/"):
                row.path = new + row.path[len(old) :]
        db.flush()
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(destination))


def remove(path):
    target = resolve(path)
    if target == UPLOAD_DIR:
        raise HTTPException(400, "Cannot delete root")
    with transaction() as db:
        lock_writes(db)
        if not target.exists():
            raise HTTPException(404, "Item not found")
        prefix = canonical(path)
        for row in db.scalars(select(Artifact).where(Artifact.deleted.is_(False))):
            if row.path == prefix or row.path.startswith(prefix + "/"):
                row.deleted = True
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
