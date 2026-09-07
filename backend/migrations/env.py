from alembic import context
from database import url
from models import Base
from sqlalchemy import create_engine, pool


def configure(connection=None):
    context.configure(
        connection=connection,
        url=url,
        target_metadata=Base.metadata,
        literal_binds=connection is None,
        compare_type=True,
        compare_server_default=True,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    configure()
else:
    args = (
        {"options": "-c lock_timeout=30000 -c statement_timeout=1200000"}
        if url.get_backend_name() == "postgresql"
        else {}
    )
    with create_engine(url, poolclass=pool.NullPool, connect_args=args).connect() as connection:
        configure(connection)
