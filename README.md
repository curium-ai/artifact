# Artifact

Self-hosted HTML sharing and review. Upload a prototype, share a stable review link,
comment on a section, and receive in-app reply notifications.

## Stack and development

FastAPI + FastMCP, PostgreSQL + SQLAlchemy/Alembic, React + TypeScript + Vite, and a
persistent filesystem for HTML revisions. The Docker image builds and serves both apps.

```sh
ARTIFACT_PASSWORD=choose-a-password ARTIFACT_MCP_TOKEN=choose-a-token docker compose up --build
```

Open http://localhost:3000. For development without Docker, start PostgreSQL, set
`DATABASE_URL`, install `backend/requirements.txt`, run `alembic -c backend/alembic.ini
upgrade head`, and start `uvicorn main:app --app-dir backend --reload --port 8000`.
Run `npm ci && npm run dev` in `frontend/`. Set `ARTIFACT_PUBLIC_URL` to the browser-facing
origin; Vite proxies the app APIs and review links to the backend.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection URL |
| `ARTIFACT_PUBLIC_URL` | `http://localhost:8000` | Externally reachable origin |
| `ARTIFACT_UPLOAD_DIR` | `backend/uploads` | Persistent files and revision objects |
| `ARTIFACT_FRONTEND_DIR` | `frontend/dist` | Built frontend |
| `ARTIFACT_MAX_FILE_BYTES` | `104857600` | 100 MiB per file |
| `ARTIFACT_AUTH_MODE` | `password` | `password` or `google` |
| `ARTIFACT_PASSWORD` | `artifact` | Shared admin password; change before deployment |
| `GOOGLE_CLIENT_ID` | empty | Google web OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | empty | Required for MCP Google authorization |
| `ARTIFACT_ALLOWED_DOMAIN` | empty | Required Google email domain in Google mode |
| `ARTIFACT_MCP_TOKEN` | empty | Bearer token in password mode; MCP denies access when absent |
| `ARTIFACT_MCP_BASE_URL` | public origin + `/mcp` | MCP OAuth resource URL |

For Google login, register your public origin as an authorized JavaScript origin and
`<public-origin>/mcp/google/callback` as an authorized redirect URI in Google Cloud.
Configure the client ID, secret, domain, and `ARTIFACT_AUTH_MODE=google` on the server.
In Google mode both raw file links and review links require sign-in. Password mode keeps
explicit `/raw/` links public while review/comment APIs require login.

## Validation

```sh
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
pytest backend/tests
ruff check backend
npm ci --prefix frontend
npm run build --prefix frontend
```

Unit tests use an isolated SQLite database by default. Set `ARTIFACT_TEST_DATABASE_URL` to
a **disposable** Postgres database for integration/concurrency tests; the test suite clears
its tables. CI runs both variants. Never point this variable at an existing deployment.

## Collaboration and direct uploads

Artifact supports one shared workspace per deployment. Google users from the configured
`ARTIFACT_ALLOWED_DOMAIN` share access to its files. Password mode retains a shared
administrator identity; use Google mode for individually attributed comments. There are
no vendor-specific domains, infrastructure IDs, or credentials in the application.
Hosting unrelated customer workspaces in one deployment requires an additional tenant
isolation layer; the current release does not claim multi-tenant isolation.

PostgreSQL now stores users, browser sessions, MCP clients and credentials, artifact IDs,
immutable revision metadata, upload grants, anchored comment threads, replies, and in-app
notifications. HTML revisions remain on the deployment's persistent disk. Back up both
Postgres and the disk together. Provision disk capacity for retained revisions and temporary
uploads; old revisions are deliberately retained so comments keep their context.

Set `DATABASE_URL` to a PostgreSQL URL and `ARTIFACT_PUBLIC_URL` to this deployment's public
origin. `ARTIFACT_MCP_BASE_URL` defaults to that origin plus `/mcp`. For HTTPS deployments,
browser cookies use `Secure`. `ARTIFACT_MAX_FILE_BYTES` defaults to `104857600` (100 MiB),
and the UI reads the limit from the server. Reverse proxies must also permit that request
size and enough time for the client's transfer. Configure a real password or Google login
and an MCP bearer token before exposing a deployment; MCP rejects unauthenticated requests
when neither OAuth nor a bearer token is configured.

`docker compose up --build` starts a local Postgres instance and a migration job before the
application. The included database credentials are local development defaults. If changing
`POSTGRES_PASSWORD`, also set the corresponding `DATABASE_URL`.

### MCP upload contract

The content-based `create_file`, `update_file`, and `append_file` tools have been removed.
Write the HTML locally and compute its byte length and lowercase SHA-256. Call
`prepare_upload(path, size, sha256, intent)` with a full destination path; `intent` is
`create` or `replace`. Send the file directly to the returned URL:

```sh
curl --fail-with-body --upload-file ./report.html "$UPLOAD_URL"
```

The URL authorizes only the prepared destination, size, checksum, and user for 30 minutes.
Treat it as a credential and redact `/api/uploads/*` paths in proxy/access logs. The response
contains `artifactId`, `revisionId`, `reviewUrl`, `url`, and the verified checksum. Successful
retries return the same revision while the grant is valid. Replacements use an optimistic
revision check: if the artifact changed since preparation, the server returns 409 and a
new grant is required. Interrupted uploads can be retried from the beginning; byte-range
resume is not implemented. `edit_file` remains available for exact text replacements and
also creates a revision. Refresh the MCP client's tool list after upgrading. New authorization flows show an Artifact
client-approval page; routine token refresh does not require another Google login or consent.

### Reviews

Use `/a/<artifact-id>` for stable review links. Existing `/v/<path>` shared links now
open the same commenting interface, preserving the requested document through sign-in.
Copying the browser URL, the file menu’s Copy review link, or the viewer’s Copy review
link all leads to review. Commenting requires authentication; anonymous comments are
not enabled. Use `/raw/<path>` explicitly for the original sandboxed HTML. In the reviewer, enable comment mode, select an element, optionally select
its containing element, and post a thread. Reply, resolve, reopen, or explicitly reattach
an outdated anchor. Only the thread author or artifact owner can resolve or reattach it.

Review rendering adds a selection bridge without modifying stored HTML. The document stays
in its opaque-origin sandbox, and the parent app owns authentication and comment writes.
Anchors store the revision, selector, element/stable IDs, tag, and text fingerprint. Across
revisions, automatic matching requires an unambiguous ID and matching text; ambiguous anchors
are marked as needing reattachment. Use stable `data-artifact-id` attributes in generated
HTML for better matching. Canvas internals and nested third-party frames are outside the
initial element-selection scope.

Owners and other thread participants receive in-app notifications for new comments/replies;
the actor is excluded. Notifications and comments commit together. The app polls every
15 seconds while visible. Email, push, external invitations, and a CLI are outside this release.

### Migrations and upgrade from SQLite

The Docker image runs `alembic upgrade head` before starting the HTTP server on
every deploy or restart. A migration failure prevents startup. PostgreSQL migration
runs are serialized with a session advisory lock, including concurrent starts.
Render services using this Dockerfile inherit this behavior; a merge triggers it
only when automatic deploys are enabled and `DATABASE_URL` is configured. A custom
Docker command overrides this startup path, so include migrations in that command
or configure a pre-deploy migration job instead.

Schema upgrades do not provision PostgreSQL or import legacy SQLite/files. Those
remain one-time setup steps below. The importer requires access to the persistent
disk; Render build and pre-deploy jobs do not mount that disk.

For a legacy deployment where the platform stops the old instance before mounting
its disk in the replacement, a one-time Docker command of
`python -u cutover_legacy.py` can perform the cutover before opening the HTTP port.
Apply schema migrations in a pre-deploy job first. This script takes and verifies
a SQLite backup and an HTML archive under the private `.cutover-backups` directory,
imports existing records, and verifies every artifact hash plus legacy sessions
and client registrations before starting Uvicorn. Any failure prevents startup.
A completion marker binds retries to the same database. Restore the normal Docker
command after the first successful deploy; retain the backups for rollback.

From `backend/`, with `DATABASE_URL` configured:

```sh
alembic upgrade head
alembic check
alembic revision --autogenerate -m "Describe schema change"
```

Review generated revisions, keep one head, and inspect offline SQL before deployment.
CI exercises upgrades, downgrade/re-upgrade, schema drift, and integration tests on Postgres.
Migrations use per-revision transactions, a 30-second lock timeout, and a 20-minute statement
timeout. Use additive migrations for rolling upgrades; do not drop a column still used by
the outgoing application. For existing populated tables, review index/constraint lock costs
and use concurrent indexes or staged validation when needed.

For an existing installation, schedule a maintenance window and stop writes. Take a
consistent SQLite backup with SQLite's backup API, plus a snapshot of the HTML disk.
Provision Postgres, apply the schema, and run the importer where that disk is mounted:

```sh
python import_legacy.py --source /path/to/auth-backup.db
python import_legacy.py --source /path/to/auth-backup.db --apply
```

The first command only reports counts. The importer reads its SQLite source in read-only
mode, skips expired sessions/access tokens, preserves OAuth registrations, hashes stored
bearer/session token keys, and backfills file IDs and initial revisions. It is rerunnable
and does not overwrite existing imported credentials. Historical file ownership remains
unknown until a named user replaces a file. Imports are separate from schema migrations
because deployment build/pre-deploy environments may not have access to the file disk.

Verify counts, representative files, web sessions, and MCP reconnect/refresh before routing
traffic to the new application. Preserve the previous image and both backups for rollback;
once new collaboration writes begin, reverting requires a data reconciliation plan. Existing
MCP clients with already-invalid registration credentials may require reconnecting; the new
server cannot reconstruct a lost client secret from the client.

Run `python maintenance.py` to preview reconciliation and orphan cleanup, or add `--apply`
to repair disk aliases, remove expired auth/upload rows, and delete abandoned temporary or
unreferenced object files older than two hours. Referenced revisions are never removed.
