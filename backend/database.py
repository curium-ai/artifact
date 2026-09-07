from contextlib import contextmanager

from settings import DATABASE_URL
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

if not DATABASE_URL:
    raise RuntimeError("Set DATABASE_URL to a PostgreSQL connection URL, then run alembic upgrade head")
url = make_url(DATABASE_URL)
if url.drivername in ("postgres", "postgresql"):
    url = url.set(drivername="postgresql+psycopg")
engine = create_engine(url, pool_pre_ping=True)
Session = sessionmaker(engine, expire_on_commit=False)


@contextmanager
def transaction():
    with Session.begin() as session:
        yield session


def lock_writes(session):
    # File publication and path changes share one lock on this disk-backed deployment.
    if engine.dialect.name == "postgresql":
        session.execute(text("SELECT pg_advisory_xact_lock(724196823)"))
