import hashlib
import secrets
import time

from database import lock_writes, transaction
from fastmcp.server.auth import AccessToken
from fastmcp.server.auth.auth import RefreshToken
from mcp.shared.auth import OAuthClientInformationFull
from models import OAuthAccess, OAuthClient, OAuthFlow, OAuthRefresh, User, WebSession
from sqlalchemy import delete, select


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def get_user(session, email=None, sub=None, name=None):
    email = email.lower() if email else "admin@localhost"
    user = session.scalar(select(User).where(User.google_sub == sub)) if sub else None
    if user is None:
        user = session.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, google_sub=sub, name=name or email)
        session.add(user)
        session.flush()
    elif sub:
        if user.google_sub and user.google_sub != sub:
            raise PermissionError("Identity does not match this account")
        user.google_sub = sub
        user.email = email
        user.name = name or user.name
    if not user.active:
        raise PermissionError("Account disabled")
    return user


class SessionStore:
    def get(self, token):
        with transaction() as db:
            row = db.get(WebSession, digest(token))
            if row is None or row.expires_at <= time.time():
                return None
            user = db.get(User, row.user_id)
            if not user or not user.active:
                return None
            return {"email": row.email, "expiry": row.expires_at, "user_id": user.id}

    def save(self, token, email, expires_at, sub=None, name=None):
        with transaction() as db:
            lock_writes(db)
            user = get_user(db, email, sub, name)
            db.merge(WebSession(token=digest(token), email=email, user_id=user.id, expires_at=expires_at))

    def renew(self, token, ttl):
        with transaction() as db:
            row = db.scalar(select(WebSession).where(WebSession.token == digest(token)).with_for_update())
            now = time.time()
            if not row or row.expires_at <= now:
                return None
            user = db.get(User, row.user_id)
            if not user or not user.active:
                return None
            result = {"email": row.email, "user_id": user.id, "cookie": None}
            # Refresh once per day. A short grace period keeps concurrent requests
            # working while the browser adopts the newly generated credential.
            if row.expires_at < now + ttl - 86400:
                replacement = secrets.token_urlsafe(32)
                db.add(
                    WebSession(
                        token=digest(replacement),
                        email=row.email,
                        user_id=user.id,
                        family_id=row.family_id,
                        expires_at=now + ttl,
                    )
                )
                row.expires_at = min(row.expires_at, now + 60)
                result["cookie"] = replacement
            return result

    def touch(self, token, new_expires_at):
        with transaction() as db:
            row = db.scalar(select(WebSession).where(WebSession.token == digest(token)).with_for_update())
            if row is None or row.expires_at <= time.time():
                return None
            user = db.get(User, row.user_id)
            if not user or not user.active:
                return None
            row.expires_at = new_expires_at
            return {"email": row.email, "expiry": row.expires_at, "user_id": user.id}

    def delete(self, token):
        with transaction() as db:
            row = db.get(WebSession, digest(token))
            if row:
                db.execute(delete(WebSession).where(WebSession.family_id == row.family_id))


class TokenStore:
    def __init__(self, db_path=None):
        pass

    def get_client(self, client_id):
        with transaction() as db:
            row = db.get(OAuthClient, client_id)
            return OAuthClientInformationFull.model_validate(row.data) if row else None

    def save_client(self, client_info):
        with transaction() as db:
            db.merge(OAuthClient(client_id=client_info.client_id, data=client_info.model_dump(mode="json")))

    def get_access_token(self, token):
        with transaction() as db:
            row = db.get(OAuthAccess, digest(token))
            if not row or (row.expires_at is not None and row.expires_at <= time.time()):
                return None
            data = {**row.data, "token": token}
            email = data.get("claims", {}).get("email")
            user = db.scalar(select(User).where(User.email == email))
            if user is None or not user.active:
                return None
            return AccessToken.model_validate(data)

    def save_access_token(self, at):
        with transaction() as db:
            db.merge(
                OAuthAccess(
                    token=digest(at.token), data=at.model_dump(mode="json", exclude={"token"}), expires_at=at.expires_at
                )
            )

    def delete_access_token(self, token):
        with transaction() as db:
            db.execute(delete(OAuthAccess).where(OAuthAccess.token == digest(token)))

    def get_refresh_token(self, token):
        with transaction() as db:
            row = db.get(OAuthRefresh, digest(token))
            return RefreshToken.model_validate({**row.data, "token": token}) if row else None

    def get_refresh_email(self, token):
        with transaction() as db:
            row = db.get(OAuthRefresh, digest(token))
            return row.email if row else None

    def save_refresh_token(self, rt, email):
        with transaction() as db:
            db.merge(
                OAuthRefresh(token=digest(rt.token), data=rt.model_dump(mode="json", exclude={"token"}), email=email)
            )

    def delete_refresh_token(self, token):
        with transaction() as db:
            db.execute(delete(OAuthRefresh).where(OAuthRefresh.token == digest(token)))

    def save_flow(self, token, data, expires_at):
        with transaction() as db:
            db.merge(OAuthFlow(token=digest(token), data=data, expires_at=expires_at))
            db.execute(delete(OAuthFlow).where(OAuthFlow.expires_at < time.time()))

    def flow(self, token, consume=False):
        with transaction() as db:
            row = db.scalar(select(OAuthFlow).where(OAuthFlow.token == digest(token)).with_for_update())
            if not row or row.expires_at <= time.time():
                return None
            data = row.data
            if consume:
                db.delete(row)
            return data
