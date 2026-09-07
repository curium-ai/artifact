import time
import uuid

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, MetaData, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def new_id():
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(table_name)s_%(column_0_name)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class WebSession(Base):
    __tablename__ = "web_sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str | None] = mapped_column(String(320))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[float] = mapped_column(Float, index=True)


class OAuthClient(Base):
    __tablename__ = "mcp_clients"
    client_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class OAuthAccess(Base):
    __tablename__ = "mcp_access_tokens"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    expires_at: Mapped[float | None] = mapped_column(Float, index=True)


class OAuthRefresh(Base):
    __tablename__ = "mcp_refresh_tokens"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    email: Mapped[str] = mapped_column(String(320))


class OAuthFlow(Base):
    __tablename__ = "mcp_flows"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    expires_at: Mapped[float] = mapped_column(Float, index=True)


class Artifact(Base):
    __tablename__ = "artifacts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    path: Mapped[str] = mapped_column(Text, unique=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    current_revision_id: Mapped[str | None] = mapped_column(String(36))
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)


class Revision(Base):
    __tablename__ = "revisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"), index=True)
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    sha256: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class UploadGrant(Base):
    __tablename__ = "upload_grants"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    path: Mapped[str] = mapped_column(Text)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    expected_revision_id: Mapped[str | None] = mapped_column(String(36))
    expires_at: Mapped[float] = mapped_column(Float, index=True)
    result: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))


class CommentThread(Base):
    __tablename__ = "comment_threads"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"), index=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("revisions.id"))
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    anchor: Mapped[dict] = mapped_column(JSON)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    thread_id: Mapped[str] = mapped_column(ForeignKey("comment_threads.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_recipient_created", "recipient_id", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    comment_id: Mapped[str] = mapped_column(ForeignKey("comments.id"))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[float] = mapped_column(Float, default=time.time)
