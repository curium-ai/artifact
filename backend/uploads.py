import errno
import hashlib
import os
import secrets
import tempfile
import time
from pathlib import Path
from typing import Literal

import anyio
from artifacts import canonical, ensure_artifact, publish, resolve, sync_alias
from database import lock_writes, transaction
from fastapi import APIRouter, HTTPException, Request
from models import UploadGrant, User
from pydantic import BaseModel, Field
from settings import MAX_FILE_BYTES, PUBLIC_URL, UPLOAD_DIR
from sqlalchemy import delete, select
from starlette.formparsers import MultiPartException, MultiPartParser
from stores import digest

router = APIRouter()


class UploadRequest(BaseModel):
    path: str = Field(max_length=2048)
    size: int = Field(gt=0, le=MAX_FILE_BYTES)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    intent: Literal["create", "replace"] = "create"


def prepare(data: UploadRequest, user_id: str):
    path = canonical(data.path)
    if not path.endswith(".html"):
        raise HTTPException(400, "Only .html files are supported")
    with transaction() as db:
        lock_writes(db)
        artifact = ensure_artifact(db, path)
        if data.intent == "create" and artifact:
            raise HTTPException(409, "File exists; use replace intent")
        if data.intent == "replace" and not artifact:
            raise HTTPException(404, "File to replace does not exist")
        db.execute(delete(UploadGrant).where(UploadGrant.expires_at < time.time()))
        pending = db.scalars(
            select(UploadGrant.token).where(UploadGrant.user_id == user_id, UploadGrant.result.is_(None))
        ).all()
        if len(pending) >= 100:
            raise HTTPException(429, "Too many pending uploads; wait for existing grants to expire")
        token = secrets.token_urlsafe(32)
        expires = time.time() + 1800
        db.add(
            UploadGrant(
                token=digest(token),
                path=path,
                user_id=user_id,
                size=data.size,
                sha256=data.sha256,
                expected_revision_id=artifact.current_revision_id if artifact else None,
                expires_at=expires,
            )
        )
    return {
        "uploadUrl": f"{PUBLIC_URL}/api/uploads/{token}",
        "method": "PUT",
        "expiresAt": expires,
        "maxFileBytes": MAX_FILE_BYTES,
        "instructions": "Upload the local file with curl --fail-with-body --upload-file FILE UPLOAD_URL. "
        "Do not send HTML through tool arguments. Treat this URL as a temporary credential.",
    }


def grant_for(token):
    with transaction() as db:
        grant = db.get(UploadGrant, digest(token))
        if not grant or grant.expires_at <= time.time():
            raise HTTPException(410, "Upload expired; prepare another upload")
        user = db.get(User, grant.user_id)
        if not user or not user.active:
            raise HTTPException(403, "Account disabled")
        return grant


def finish(token, temporary, checksum, size):
    with transaction() as db:
        lock_writes(db)
        grant = db.scalar(select(UploadGrant).where(UploadGrant.token == digest(token)).with_for_update())
        if not grant or grant.expires_at <= time.time():
            raise HTTPException(410, "Upload expired")
        user = db.get(User, grant.user_id)
        if not user or not user.active:
            raise HTTPException(403, "Account disabled")
        if grant.result:
            return grant.result
        if checksum != grant.sha256 or size != grant.size:
            raise HTTPException(422, "Upload size or checksum does not match")
        result = publish(db, grant.path, temporary, grant.user_id, grant.expected_revision_id, checksum, size)
        grant.result = result
    sync_alias(result)
    return result


@router.put("/api/uploads/{token}")
async def upload(token: str, request: Request):
    grant = await anyio.to_thread.run_sync(grant_for, token)
    if grant.result:
        await anyio.to_thread.run_sync(sync_alias, grant.result)
        return grant.result
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) != grant.size):
        raise HTTPException(422, "Content-Length does not match prepared size")
    staging = UPLOAD_DIR / ".staging"
    await anyio.to_thread.run_sync(lambda: staging.mkdir(parents=True, exist_ok=True))
    fd, name = await anyio.to_thread.run_sync(lambda: tempfile.mkstemp(dir=staging))
    os.close(fd)
    size, checksum = 0, hashlib.sha256()
    try:
        async with await anyio.open_file(name, "wb") as stream:
            async for chunk in request.stream():
                size += len(chunk)
                if size > grant.size or size > MAX_FILE_BYTES:
                    raise HTTPException(413, "Upload exceeds allowed size")
                checksum.update(chunk)
                await stream.write(chunk)
            await stream.flush()
            await anyio.to_thread.run_sync(os.fsync, stream.wrapped.fileno())
        return await anyio.to_thread.run_sync(finish, token, name, checksum.hexdigest(), size)
    except OSError as error:
        if error.errno in (errno.ENOSPC, errno.EDQUOT):
            raise HTTPException(507, "Storage is full; retry after freeing space") from error
        raise
    finally:
        Path(name).unlink(missing_ok=True)


class LimitedMultipartParser(MultiPartParser):
    def on_part_begin(self):
        super().on_part_begin()
        self.part_bytes = 0

    def on_part_data(self, data, start, end):
        self.part_bytes += end - start
        if self.part_bytes > MAX_FILE_BYTES:
            raise MultiPartException("File exceeds configured size limit")
        super().on_part_data(data, start, end)


async def browser_upload(request, path, user_id):
    uploaded = []
    parser = LimitedMultipartParser(request.headers, request.stream(), max_files=20, max_fields=10)
    try:
        form = await parser.parse()
    except MultiPartException as error:
        raise HTTPException(413, str(error)) from error
    try:
        for _, upload in form.multi_items():
            if not getattr(upload, "filename", None) or not upload.filename.endswith(".html"):
                continue
            if "/" in upload.filename or "\\" in upload.filename:
                raise HTTPException(400, "Invalid filename")
            destination = canonical(path.rstrip("/") + "/" + upload.filename)
            resolve(destination)
            if upload.size is not None and upload.size > MAX_FILE_BYTES:
                raise HTTPException(413, "File exceeds configured size limit")
            staging = UPLOAD_DIR / ".staging"
            staging.mkdir(parents=True, exist_ok=True)
            fd, name = tempfile.mkstemp(dir=staging)
            os.close(fd)
            size, checksum = 0, hashlib.sha256()
            try:
                async with await anyio.open_file(name, "wb") as stream:
                    while chunk := await upload.read(1024 * 1024):
                        size += len(chunk)
                        if size > MAX_FILE_BYTES:
                            raise HTTPException(413, "File exceeds configured size limit")
                        checksum.update(chunk)
                        await stream.write(chunk)

                def commit(destination=destination, name=name, checksum=checksum, size=size):
                    with transaction() as db:
                        lock_writes(db)
                        existing = ensure_artifact(db, destination)
                        result = publish(
                            db,
                            destination,
                            name,
                            user_id,
                            existing.current_revision_id if existing else None,
                            checksum.hexdigest(),
                            size,
                        )
                    sync_alias(result)
                    return result

                await anyio.to_thread.run_sync(commit)
                uploaded.append(upload.filename)
            except OSError as error:
                if error.errno in (errno.ENOSPC, errno.EDQUOT):
                    raise HTTPException(507, "Storage is full") from error
                raise
            finally:
                Path(name).unlink(missing_ok=True)
    finally:
        await form.close()
    return {"uploaded": uploaded, "count": len(uploaded)}
