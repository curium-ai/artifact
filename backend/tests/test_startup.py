import os
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize("migration_exit", [0, 1])
def test_startup_serves_only_after_successful_migration(tmp_path, migration_exit):
    """A failed schema upgrade must never expose a running application."""
    (tmp_path / "alembic").write_text(f"#!/bin/sh\necho migration\nexit {migration_exit}\n")
    (tmp_path / "uvicorn").write_text('#!/bin/sh\nprintf "server %s\\n" "$*"\n')
    for executable in tmp_path.iterdir():
        executable.chmod(0o700)
    script = Path(__file__).resolve().parents[1] / "start.sh"
    result = subprocess.run(
        ["/bin/sh", str(script)],
        env={**os.environ, "PATH": str(tmp_path), "PORT": "8765"},
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == migration_exit
    lines = result.stdout.splitlines()
    assert lines[0] == "migration"
    if migration_exit:
        assert len(lines) == 1
    else:
        assert lines[1] == "server main:app --host 0.0.0.0 --port 8765"
