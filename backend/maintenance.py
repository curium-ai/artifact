"""Reconcile file aliases and remove abandoned staging files. Defaults to dry run."""

import argparse
import time

from artifacts import sync_alias
from database import lock_writes, transaction
from models import Artifact, OAuthAccess, OAuthFlow, Revision, UploadGrant, WebSession
from settings import UPLOAD_DIR
from sqlalchemy import delete, select


def maintain(apply=False):
    cutoff = time.time() - 7200
    with transaction() as db:
        lock_writes(db)
        revisions = set(db.scalars(select(Revision.id)))
        artifacts = db.scalars(select(Artifact).where(Artifact.deleted.is_(False))).all()
        abandoned = []
        for folder in (".staging", ".objects"):
            directory = UPLOAD_DIR / folder
            if directory.exists():
                for path in directory.iterdir():
                    if (
                        path.is_file()
                        and path.stat().st_mtime < cutoff
                        and (folder == ".staging" or path.stem not in revisions)
                    ):
                        abandoned.append(path)
        if apply:
            for path in abandoned:
                path.unlink(missing_ok=True)
            for model in (OAuthAccess, OAuthFlow, UploadGrant, WebSession):
                db.execute(delete(model).where(model.expires_at < time.time()))
    if apply:
        for artifact in artifacts:
            sync_alias({"artifactId": artifact.id})
    return {"artifacts": len(artifacts), "abandonedFiles": len(abandoned), "applied": apply}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    print(maintain(parser.parse_args().apply))
