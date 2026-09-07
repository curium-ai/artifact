"""Track session families for safe cookie renewal and logout."""

import sqlalchemy as sa
from alembic import op

revision = "b95f861d7a02"
down_revision = "e0ccc83238cb"
branch_labels = None
depends_on = None


# Complexity: O(n), one update of web_sessions; no joins or per-row queries.
def upgrade():
    op.add_column("web_sessions", sa.Column("family_id", sa.String(64), nullable=True))
    sessions = sa.table("web_sessions", sa.column("family_id", sa.String(64)), sa.column("token", sa.String(64)))
    op.execute(sessions.update().values(family_id=sessions.c.token))
    with op.batch_alter_table("web_sessions") as batch:
        batch.alter_column("family_id", existing_type=sa.String(64), nullable=False)
        batch.create_index("ix_web_sessions_family_id", ["family_id"])


def downgrade():
    with op.batch_alter_table("web_sessions") as batch:
        batch.drop_index("ix_web_sessions_family_id")
        batch.drop_column("family_id")
