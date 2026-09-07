import os
import re
from pathlib import Path
from typing import Annotated
from urllib.parse import urlencode
from uuid import UUID

from artifacts import artifact_for_path, object_path
from database import transaction
from fastapi import APIRouter, Cookie, Depends, HTTPException
from fastapi.responses import RedirectResponse, StreamingResponse
from models import Artifact, Comment, CommentThread, Notification, Revision, User
from pydantic import BaseModel, Field
from settings import UPLOAD_DIR
from sqlalchemy import select
from stores import SessionStore

router = APIRouter()
session_store = SessionStore()


def current_user(artifact_session: str | None = Cookie(None)):
    session = session_store.get(artifact_session) if artifact_session else None
    if not session:
        raise HTTPException(401, "Authentication required")
    return session["user_id"]


def active_artifact(db, artifact_id):
    artifact = db.get(Artifact, artifact_id)
    if not artifact or artifact.deleted:
        raise HTTPException(404, "Artifact not found")
    return artifact


class Anchor(BaseModel):
    selector: str = Field(min_length=1, max_length=4096)
    text: str = Field(max_length=500)
    tag: str = Field(min_length=1, max_length=32)
    elementId: str = Field(default="", max_length=512)
    stableId: str = Field(default="", max_length=512)


class ThreadInput(BaseModel):
    revisionId: str
    anchor: Anchor
    body: str = Field(min_length=1, max_length=10000)


class ReplyInput(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class ThreadPatch(BaseModel):
    resolved: bool | None = None
    anchor: Anchor | None = None
    revisionId: str | None = None


@router.get("/api/artifact")
def lookup_artifact(path: str, user_id: Annotated[str, Depends(current_user)]):
    artifact = artifact_for_path(path)
    return {
        "id": artifact.id,
        "path": artifact.path,
        "revisionId": artifact.current_revision_id,
        "userId": user_id,
        "ownerId": artifact.owner_id,
    }


@router.get("/api/artifacts/{artifact_id}")
def artifact_detail(artifact_id: str, user_id: Annotated[str, Depends(current_user)]):
    with transaction() as db:
        artifact = active_artifact(db, artifact_id)
        return {
            "id": artifact.id,
            "path": artifact.path,
            "revisionId": artifact.current_revision_id,
            "userId": user_id,
            "ownerId": artifact.owner_id,
        }


@router.get("/a/{artifact_id}")
def review_link(artifact_id: UUID):
    # The SPA retains this identifier across login, then resolves it with auth.
    return RedirectResponse("/browse?" + urlencode({"artifact": str(artifact_id)}), status_code=302)


@router.get("/api/artifacts/{artifact_id}/review/{revision_id}")
def review_html(artifact_id: str, revision_id: str, user_id: Annotated[str, Depends(current_user)]):
    with transaction() as db:
        active_artifact(db, artifact_id)
        revision = db.get(Revision, revision_id)
        if not revision or revision.artifact_id != artifact_id:
            raise HTTPException(404, "Revision not found")
    bridge = Path(__file__).with_name("static").joinpath("review.js").read_bytes()

    def body():
        # The bridge runs before document scripts and does not change stored HTML.
        base = os.path.realpath(UPLOAD_DIR / ".objects")
        candidate = os.path.realpath(object_path(revision_id))
        if not candidate.startswith(base + os.sep):
            raise HTTPException(400, "Invalid revision path")
        with open(candidate, "rb") as stream:
            first = stream.read(65536)
            doctype = re.match(rb"(?:\xef\xbb\xbf)?\s*<!doctype\s+html[^>]*>", first, flags=re.IGNORECASE)
            offset = doctype.end() if doctype else 0
            yield first[:offset] + b"<script>" + bridge + b"</script>" + first[offset:]
            while chunk := stream.read(65536):
                yield chunk

    return StreamingResponse(
        body(),
        media_type="text/html",
        headers={
            "Content-Security-Policy": "sandbox allow-scripts",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


def add_comment(db, artifact, thread, user_id, body):
    if not body.strip():
        raise HTTPException(422, "Comment cannot be blank")
    recipients = set(db.scalars(select(Comment.author_id).where(Comment.thread_id == thread.id)).all())
    recipients.add(thread.author_id)
    if artifact.owner_id:
        recipients.add(artifact.owner_id)
    recipients.discard(user_id)
    comment = Comment(thread_id=thread.id, author_id=user_id, body=body.strip())
    db.add(comment)
    db.flush()
    for recipient in recipients:
        db.add(Notification(recipient_id=recipient, actor_id=user_id, comment_id=comment.id))
    return {"id": comment.id, "threadId": thread.id}


@router.get("/api/artifacts/{artifact_id}/threads")
def threads(artifact_id: str, user_id: Annotated[str, Depends(current_user)]):
    with transaction() as db:
        active_artifact(db, artifact_id)
        rows = db.scalars(
            select(CommentThread).where(CommentThread.artifact_id == artifact_id).order_by(CommentThread.created_at)
        ).all()
        comments = db.execute(
            select(Comment, User)
            .join(User, User.id == Comment.author_id)
            .join(CommentThread, Comment.thread_id == CommentThread.id)
            .where(CommentThread.artifact_id == artifact_id)
            .order_by(Comment.created_at)
        ).all()
        grouped = {}
        for comment, user in comments:
            grouped.setdefault(comment.thread_id, []).append(
                {
                    "id": comment.id,
                    "author": user.name,
                    "authorId": user.id,
                    "body": comment.body,
                    "createdAt": comment.created_at,
                }
            )
        return [
            {
                "id": row.id,
                "revisionId": row.revision_id,
                "anchor": row.anchor,
                "resolved": row.resolved,
                "authorId": row.author_id,
                "comments": grouped.get(row.id, []),
            }
            for row in rows
        ]


@router.post("/api/artifacts/{artifact_id}/threads", status_code=201)
def create_thread(artifact_id: str, data: ThreadInput, user_id: Annotated[str, Depends(current_user)]):
    with transaction() as db:
        artifact = active_artifact(db, artifact_id)
        if data.revisionId != artifact.current_revision_id:
            raise HTTPException(409, "Artifact updated; reload before commenting")
        thread = CommentThread(
            artifact_id=artifact_id, revision_id=data.revisionId, author_id=user_id, anchor=data.anchor.model_dump()
        )
        db.add(thread)
        db.flush()
        return add_comment(db, artifact, thread, user_id, data.body)


def get_thread(db, thread_id):
    thread = db.scalar(select(CommentThread).where(CommentThread.id == thread_id).with_for_update())
    if not thread:
        raise HTTPException(404, "Thread not found")
    artifact = active_artifact(db, thread.artifact_id)
    return thread, artifact


@router.post("/api/threads/{thread_id}/replies", status_code=201)
def reply(thread_id: str, data: ReplyInput, user_id: Annotated[str, Depends(current_user)]):
    with transaction() as db:
        thread, artifact = get_thread(db, thread_id)
        if thread.resolved:
            raise HTTPException(409, "Reopen the thread before replying")
        return add_comment(db, artifact, thread, user_id, data.body)


@router.patch("/api/threads/{thread_id}")
def update_thread(thread_id: str, data: ThreadPatch, user_id: Annotated[str, Depends(current_user)]):
    with transaction() as db:
        thread, artifact = get_thread(db, thread_id)
        if user_id not in (thread.author_id, artifact.owner_id):
            raise HTTPException(403, "Only the thread author or artifact owner can change this thread")
        if data.anchor:
            if data.revisionId != artifact.current_revision_id:
                raise HTTPException(409, "Reload the artifact before reattaching")
            thread.anchor = data.anchor.model_dump()
            thread.revision_id = data.revisionId
        if data.resolved is not None:
            thread.resolved = data.resolved
        return {"ok": True}


@router.get("/api/notifications")
def notifications(user_id: Annotated[str, Depends(current_user)]):
    with transaction() as db:
        rows = db.execute(
            select(Notification, User, Comment, CommentThread, Artifact)
            .join(User, User.id == Notification.actor_id)
            .join(Comment, Comment.id == Notification.comment_id)
            .join(CommentThread, CommentThread.id == Comment.thread_id)
            .join(Artifact, Artifact.id == CommentThread.artifact_id)
            .where(Notification.recipient_id == user_id, Artifact.deleted.is_(False))
            .order_by(Notification.created_at.desc())
            .limit(100)
        ).all()
        return [
            {
                "id": n.id,
                "actor": u.name,
                "body": c.body[:200],
                "read": n.read,
                "artifactId": a.id,
                "path": a.path,
                "threadId": t.id,
                "createdAt": n.created_at,
            }
            for n, u, c, t, a in rows
        ]


@router.post("/api/notifications/{notification_id}/read")
def read_notification(notification_id: str, user_id: Annotated[str, Depends(current_user)]):
    with transaction() as db:
        notification = db.get(Notification, notification_id)
        if not notification or notification.recipient_id != user_id:
            raise HTTPException(404, "Notification not found")
        notification.read = True
        return {"ok": True}
