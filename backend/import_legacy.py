"""Import a read-only SQLite snapshot and existing HTML files after schema migration."""

import argparse
import json
import sqlite3
import time
from pathlib import Path

from artifacts import ensure_artifact
from database import lock_writes, transaction
from models import OAuthAccess, OAuthClient, OAuthRefresh, WebSession
from settings import UPLOAD_DIR
from stores import digest, get_user


def import_legacy(source, apply=False):
    counts = {"web_sessions": 0, "mcp_clients": 0, "mcp_access_tokens": 0, "mcp_refresh_tokens": 0, "files": 0}
    with sqlite3.connect(Path(source).resolve().as_uri() + "?mode=ro", uri=True) as old:
        old.row_factory = sqlite3.Row
        tables = {r[0] for r in old.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        with transaction() as db:
            lock_writes(db)
            for table in list(counts)[:-1]:
                if table not in tables:
                    continue
                for row in old.execute(f'SELECT * FROM "{table}"'):
                    if (
                        table in ("web_sessions", "mcp_access_tokens")
                        and row["expires_at"] is not None
                        and row["expires_at"] <= time.time()
                    ):
                        continue
                    counts[table] += 1
                    if not apply:
                        continue
                    if table == "web_sessions":
                        user = get_user(db, row["email"])
                        record = WebSession(
                            token=digest(row["token"]),
                            email=row["email"],
                            user_id=user.id,
                            expires_at=row["expires_at"],
                        )
                    elif table == "mcp_clients":
                        record = OAuthClient(client_id=row["client_id"], data=json.loads(row["data"]))
                    else:
                        data = json.loads(row["data"])
                        data.pop("token", None)
                        if table == "mcp_access_tokens":
                            get_user(db, data.get("claims", {}).get("email"))
                            record = OAuthAccess(token=digest(row["token"]), data=data, expires_at=row["expires_at"])
                        else:
                            get_user(db, row["email"])
                            record = OAuthRefresh(token=digest(row["token"]), data=data, email=row["email"])
                    key = record.client_id if table == "mcp_clients" else record.token
                    if db.get(type(record), key) is None:
                        db.add(record)
            for file in UPLOAD_DIR.rglob("*.html"):
                if any(p.startswith(".") for p in file.relative_to(UPLOAD_DIR).parts):
                    continue
                counts["files"] += 1
                if apply:
                    ensure_artifact(db, "/" + file.relative_to(UPLOAD_DIR).as_posix())
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Path to a consistent legacy SQLite backup")
    parser.add_argument("--apply", action="store_true", help="Import into DATABASE_URL; default only reports counts")
    args = parser.parse_args()
    print(json.dumps({"applied": args.apply, "counts": import_legacy(args.source, args.apply)}))
